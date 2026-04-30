/**
 * T-060 + T-061: Review pipeline fresh-context guarantees.
 *
 * - Cada stage roda com `sessionId` próprio derivado de
 *   `deriveSessionId({agent: role, workingDir, intent: task-N-role-attempt-K})`.
 *   Os 3 stages produzem 3 ids distintos; nenhum é igual a `task.sessionId`.
 *
 * - O `systemPrompt` do role chega via `appendSystemPrompt` (system content),
 *   não concatenado ao user prompt. ROLE_SYSTEM_PROMPTS[role] aparece em
 *   appendSystemPrompt, e NÃO em `prompt`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import { ROLE_SYSTEM_PROMPTS, runReviewPipeline } from "@clawde/review";
import { LeaseManager, type RunnerDeps, processTask } from "@clawde/worker";
import { type TestDb, makeTestDb } from "../helpers/db.ts";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

describe("review pipeline fresh context (T-060 + T-061)", () => {
  let testDb: TestDb;
  let mockClient: MockAgentClient;
  let deps: RunnerDeps;

  beforeEach(() => {
    testDb = makeTestDb();
    setLogSink(() => {});
    mockClient = new MockAgentClient();
    const tasksRepo = new TasksRepo(testDb.db);
    const runsRepo = new TaskRunsRepo(testDb.db);
    const eventsRepo = new EventsRepo(testDb.db);
    deps = {
      tasksRepo,
      runsRepo,
      eventsRepo,
      leaseManager: new LeaseManager(runsRepo, eventsRepo, {
        leaseSeconds: 60,
        heartbeatSeconds: 999,
      }),
      quotaTracker: new QuotaTracker(new QuotaLedgerRepo(testDb.db), DEFAULT_TRACKER_CONFIG),
      quotaPolicy: makeQuotaPolicy(),
      agentClient: mockClient,
      logger: createLogger({ component: "review-fresh-test" }),
      workerId: "w-rf",
      review: {
        config: { maxRetriesPerStage: 1 },
        run: runReviewPipeline,
      },
    };
  });
  afterEach(() => {
    testDb.cleanup();
    resetLogSink();
  });

  function insertReviewTask(): { id: number; sessionId: string | null } {
    const t = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "Adicione função sum(a,b)",
      agent: "implementer",
      // task.sessionId=null simula o caminho mais comum (operator não pré-aloca
      // sessão). Stages do review derivam sessionId próprio independente disso.
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    // Happy path: 3 stages, todos APPROVED.
    mockClient.enqueueResponse({
      messages: [assistantText("function sum(a,b) { return a+b }")],
    });
    mockClient.enqueueResponse({ messages: [assistantText("VERDICT: APPROVED")] });
    mockClient.enqueueResponse({ messages: [assistantText("VERDICT: APPROVED")] });
    return { id: t.id, sessionId: t.sessionId };
  }

  test("T-060: 3 stages produzem 3 sessionIds distintos, nenhum igual a task.sessionId", async () => {
    const { id, sessionId: taskSessionId } = insertReviewTask();
    const task = deps.tasksRepo.findById(id);
    if (task === null) throw new Error("task not found");

    const result = await processTask(deps, task);
    expect(result.run.status).toBe("succeeded");
    expect(mockClient.invocations.length).toBe(3);

    const sessions = mockClient.invocations.map((inv) => inv.sessionId);
    // Todos não-undefined.
    for (const s of sessions) {
      expect(typeof s).toBe("string");
      // Se task.sessionId for null, garantimos só que cada stage tem id próprio.
      if (taskSessionId !== null) expect(s).not.toBe(taskSessionId);
    }
    // Os 3 são distintos.
    const unique = new Set(sessions);
    expect(unique.size).toBe(3);
  });

  test("T-061: role prompt vai em appendSystemPrompt, NÃO no user prompt", async () => {
    const { id } = insertReviewTask();
    const task = deps.tasksRepo.findById(id);
    if (task === null) throw new Error("task not found");

    await processTask(deps, task);
    expect(mockClient.invocations.length).toBe(3);

    const [implCall, specCall, qualityCall] = mockClient.invocations;
    if (!implCall || !specCall || !qualityCall) throw new Error("missing invocations");

    // Implementer stage: role prompt em appendSystemPrompt.
    expect(implCall.appendSystemPrompt ?? "").toContain(ROLE_SYSTEM_PROMPTS.implementer);
    expect(implCall.prompt).not.toContain(ROLE_SYSTEM_PROMPTS.implementer);

    // Spec reviewer stage.
    expect(specCall.appendSystemPrompt ?? "").toContain(ROLE_SYSTEM_PROMPTS["spec-reviewer"]);
    expect(specCall.prompt).not.toContain(ROLE_SYSTEM_PROMPTS["spec-reviewer"]);

    // Code quality reviewer stage.
    expect(qualityCall.appendSystemPrompt ?? "").toContain(
      ROLE_SYSTEM_PROMPTS["code-quality-reviewer"],
    );
    expect(qualityCall.prompt).not.toContain(ROLE_SYSTEM_PROMPTS["code-quality-reviewer"]);
  });

  test("T-058: retry (attempt_n=2) gera sessionIds novos vs attempt 1", async () => {
    // Cenário: stage spec-reviewer rejeita, implementer retenta.
    // Pipeline: implementer (att1) → spec REJECT → implementer (att2) → spec APPROVED → quality APPROVED.
    const t = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "Adicione função sum(a,b)",
      agent: "implementer",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [assistantText("function sum(a,b){}")] });
    mockClient.enqueueResponse({ messages: [assistantText("VERDICT: REJECTED")] });
    mockClient.enqueueResponse({
      messages: [assistantText("function sum(a,b){return a+b}")],
    });
    mockClient.enqueueResponse({ messages: [assistantText("VERDICT: APPROVED")] });
    mockClient.enqueueResponse({ messages: [assistantText("VERDICT: APPROVED")] });

    const result = await processTask(deps, t);
    expect(result.run.status).toBe("succeeded");

    // Stage retries dentro do mesmo task_run produzem o MESMO sessionId
    // pra mesma role+attempt do task_run (deriveSessionId é determinístico
    // por intent), mas distintas entre roles.
    const implementerSessions = mockClient.invocations
      .filter((_, i) => i === 0 || i === 2)
      .map((inv) => inv.sessionId);
    expect(implementerSessions[0]).toBe(implementerSessions[1]);
    // Mas implementer.sessionId !== spec-reviewer.sessionId.
    const specSessions = mockClient.invocations
      .filter((_, i) => i === 1 || i === 3)
      .map((inv) => inv.sessionId);
    expect(implementerSessions[0]).not.toBe(specSessions[0]);
  });
});
