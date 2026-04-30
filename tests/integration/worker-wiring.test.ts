/**
 * Integration tests: Worker wired com (a) memory inject e (b) review pipeline.
 *
 * Não testa a lógica interna de memory/review (já coberta por unit tests),
 * apenas que o worker dispara essas integrações quando deps opt-in estão
 * presentes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { MemoryRepo } from "@clawde/db/repositories/memory";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import {
  DEFAULT_MEMORY_AWARE_CONFIG,
  type MemoryContextResult,
  type buildMemoryContext,
} from "@clawde/memory";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import { runReviewPipeline } from "@clawde/review";
import { LeaseManager, type RunnerDeps, processTask } from "@clawde/worker";
import { type TestDb, makeTestDb } from "../helpers/db.ts";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

function baseDeps(testDb: TestDb, mockClient: MockAgentClient): RunnerDeps {
  const tasksRepo = new TasksRepo(testDb.db);
  const runsRepo = new TaskRunsRepo(testDb.db);
  const eventsRepo = new EventsRepo(testDb.db);
  const quotaRepo = new QuotaLedgerRepo(testDb.db);
  const lease = new LeaseManager(runsRepo, eventsRepo, {
    leaseSeconds: 60,
    heartbeatSeconds: 999,
  });
  const tracker = new QuotaTracker(quotaRepo, DEFAULT_TRACKER_CONFIG);
  return {
    tasksRepo,
    runsRepo,
    eventsRepo,
    leaseManager: lease,
    quotaTracker: tracker,
    quotaPolicy: makeQuotaPolicy(),
    agentClient: mockClient,
    logger: createLogger({ component: "test-wire" }),
    workerId: "worker-test",
  };
}

describe("worker memory inject (opt-in)", () => {
  let testDb: TestDb;
  let mockClient: MockAgentClient;

  beforeEach(() => {
    testDb = makeTestDb();
    setLogSink(() => {});
    mockClient = new MockAgentClient();
  });
  afterEach(() => {
    testDb.cleanup();
    resetLogSink();
  });

  test("quando memoryInject opt-in, o prompt enviado ao SDK contém prior_context", async () => {
    const deps = baseDeps(testDb, mockClient);
    const memoryRepo = new MemoryRepo(testDb.db);

    const fakeBuild = (async (_repo: MemoryRepo, _query: string): Promise<MemoryContextResult> => ({
      injected: true,
      snippet: '<prior_context source="clawde-memory">RULE_X: never</prior_context>',
      observations: [],
      truncated: 0,
    })) as unknown as typeof buildMemoryContext;

    const enrichedDeps: RunnerDeps = {
      ...deps,
      memoryInject: {
        memoryRepo,
        config: DEFAULT_MEMORY_AWARE_CONFIG,
        buildContext: fakeBuild,
      },
    };

    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "explica X",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });

    await processTask(enrichedDeps, task);
    expect(mockClient.invocations.length).toBe(1);
    const sentPrompt = mockClient.invocations[0]?.prompt ?? "";
    const sentSystem = mockClient.invocations[0]?.appendSystemPrompt ?? "";
    // T-055: memory snippet é system prompt confiável, NÃO user content.
    expect(sentSystem).toContain("RULE_X: never");
    expect(sentPrompt).not.toContain("RULE_X: never");
    expect(sentPrompt).toContain("explica X");
  });

  test("memoryInject.config.enabled=false não modifica o prompt", async () => {
    const deps = baseDeps(testDb, mockClient);
    const memoryRepo = new MemoryRepo(testDb.db);

    const fakeBuild = (async (): Promise<MemoryContextResult> => ({
      injected: false,
      snippet: "",
      observations: [],
      truncated: 0,
    })) as unknown as typeof buildMemoryContext;

    const enrichedDeps: RunnerDeps = {
      ...deps,
      memoryInject: {
        memoryRepo,
        config: { ...DEFAULT_MEMORY_AWARE_CONFIG, enabled: false },
        buildContext: fakeBuild,
      },
    };

    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "explica X",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });

    await processTask(enrichedDeps, task);
    const sentPrompt = mockClient.invocations[0]?.prompt ?? "";
    expect(sentPrompt).toBe("explica X");
  });

  test("falha do buildContext não bloqueia execução (warn + segue)", async () => {
    const deps = baseDeps(testDb, mockClient);
    const memoryRepo = new MemoryRepo(testDb.db);

    const failingBuild = (async (): Promise<MemoryContextResult> => {
      throw new Error("xenova model not loaded");
    }) as unknown as typeof buildMemoryContext;

    const enrichedDeps: RunnerDeps = {
      ...deps,
      memoryInject: {
        memoryRepo,
        config: DEFAULT_MEMORY_AWARE_CONFIG,
        buildContext: failingBuild,
      },
    };

    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "p",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });
    const result = await processTask(enrichedDeps, task);
    expect(result.run.status).toBe("succeeded");
  });
});

describe("worker review pipeline (opt-in)", () => {
  let testDb: TestDb;
  let mockClient: MockAgentClient;

  beforeEach(() => {
    testDb = makeTestDb();
    setLogSink(() => {});
    mockClient = new MockAgentClient();
  });
  afterEach(() => {
    testDb.cleanup();
    resetLogSink();
  });

  test("quando review opt-in, agentClient é invocado 3x (impl + 2 reviewers) e events.review.* gravados", async () => {
    const deps = baseDeps(testDb, mockClient);
    // 3 stages happy path: implementer, spec-reviewer (APPROVED), quality (APPROVED).
    mockClient.enqueueResponse({ messages: [assistantText("function sum(a,b) { return a+b }")] });
    mockClient.enqueueResponse({ messages: [assistantText("VERDICT: APPROVED")] });
    mockClient.enqueueResponse({ messages: [assistantText("VERDICT: APPROVED")] });

    const enrichedDeps: RunnerDeps = {
      ...deps,
      review: {
        config: { maxRetriesPerStage: 1 },
        run: runReviewPipeline,
      },
    };

    const task = deps.tasksRepo.insert({
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

    const result = await processTask(enrichedDeps, task);
    expect(result.run.status).toBe("succeeded");
    expect(mockClient.invocations.length).toBe(3);

    const events = deps.eventsRepo.queryByTaskRun(result.run.id);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("review.implementer.end");
    expect(kinds).toContain("review.spec.verdict");
    expect(kinds).toContain("review.quality.verdict");
    expect(kinds).toContain("review.pipeline.complete");
  });

  test("review pipeline com REJECTED reflete em events.review.pipeline.exhausted", async () => {
    const deps = baseDeps(testDb, mockClient);
    // implementer + spec-reviewer (REJECTED) por 3 rounds (max 2 retries → 3 implementers).
    for (let i = 0; i < 3; i++) {
      mockClient.enqueueResponse({ messages: [assistantText(`v${i}`)] });
      mockClient.enqueueResponse({
        messages: [assistantText("Missing impl.\nVERDICT: REJECTED")],
      });
    }

    const enrichedDeps: RunnerDeps = {
      ...deps,
      review: {
        config: { maxRetriesPerStage: 2 },
        run: runReviewPipeline,
      },
    };

    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "Add sum",
      agent: "implementer",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });

    const result = await processTask(enrichedDeps, task);
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toContain("review pipeline exhausted");

    const events = deps.eventsRepo.queryByTaskRun(result.run.id);
    expect(events.map((e) => e.kind)).toContain("review.pipeline.exhausted");
  });

  test("agente inexistente em task retorna erro claro", async () => {
    const deps = baseDeps(testDb, mockClient);
    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "Add sum",
      agent: "nonexistent",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    const withResolver: RunnerDeps = {
      ...deps,
      resolveAgentDefinition: async () => null,
    };

    await expect(processTask(withResolver, task)).rejects.toThrow(
      "agent 'nonexistent' not found in AGENT.md definitions",
    );
  });
});
