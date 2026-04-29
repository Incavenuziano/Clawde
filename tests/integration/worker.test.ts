import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import { SdkRateLimitError } from "@clawde/sdk";
import { LeaseManager, type RunnerDeps, processNextPending, processTask } from "@clawde/worker";
import { type TestDb, makeTestDb } from "../helpers/db.ts";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

describe("worker/runner end-to-end (com SDK mocked)", () => {
  let testDb: TestDb;
  let deps: RunnerDeps;
  let mockClient: MockAgentClient;

  beforeEach(() => {
    testDb = makeTestDb();
    setLogSink(() => {}); // silenciar logs durante test

    const tasksRepo = new TasksRepo(testDb.db);
    const runsRepo = new TaskRunsRepo(testDb.db);
    const eventsRepo = new EventsRepo(testDb.db);
    const quotaRepo = new QuotaLedgerRepo(testDb.db);
    const lease = new LeaseManager(runsRepo, eventsRepo, {
      leaseSeconds: 60,
      heartbeatSeconds: 999,
    });
    const tracker = new QuotaTracker(quotaRepo, DEFAULT_TRACKER_CONFIG);
    mockClient = new MockAgentClient();

    deps = {
      tasksRepo,
      runsRepo,
      eventsRepo,
      leaseManager: lease,
      quotaTracker: tracker,
      quotaPolicy: makeQuotaPolicy(),
      agentClient: mockClient,
      logger: createLogger({ component: "test-worker" }),
      workerId: "worker-test",
    };
  });
  afterEach(() => {
    testDb.cleanup();
    resetLogSink();
  });

  test("processTask end-to-end: succeeded com 3 messages", async () => {
    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "test",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({
      messages: [assistantText("Olá"), assistantText("Processando"), assistantText("Pronto")],
    });

    const result = await processTask(deps, task);
    expect(result.run.status).toBe("succeeded");
    expect(result.agentResult.msgsConsumed).toBe(3);
    expect(result.run.result).toContain("Pronto");
    expect(result.run.msgsConsumed).toBe(3);
  });

  test("eventos completos registrados (task_start, invocation_*, task_finish)", async () => {
    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "test",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({
      messages: [assistantText("ok")],
    });

    const result = await processTask(deps, task);
    const events = deps.eventsRepo.queryByTaskRun(result.run.id);
    const kinds = events.map((e) => e.kind);

    expect(kinds).toContain("task_start");
    expect(kinds).toContain("claude_invocation_start");
    expect(kinds).toContain("claude_invocation_end");
    expect(kinds).toContain("task_finish");
  });

  test("quota ledger registra cada message processada", async () => {
    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "test",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({
      messages: [assistantText("a"), assistantText("b"), assistantText("c")],
    });

    await processTask(deps, task);
    const ledger = deps.quotaTracker.currentWindow();
    expect(ledger.msgsConsumed).toBe(3);
  });

  test("agent erro vira task_run failed com error preservado", async () => {
    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "test",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({
      messages: [assistantText("partial")],
      throwAfter: new Error("rate_limit_exceeded"),
    });

    const result = await processTask(deps, task);
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toContain("rate_limit_exceeded");
    expect(result.agentResult.error).toContain("rate_limit_exceeded");
  });

  test("processNextPending pula tasks já com run", async () => {
    const t1 = deps.tasksRepo.insert({
      priority: "URGENT",
      prompt: "first",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "second",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });

    const r1 = await processNextPending(deps);
    expect(r1?.task.id).toBe(t1.id); // URGENT processa primeiro
    const r2 = await processNextPending(deps);
    expect(r2?.task.prompt).toBe("second");

    // Sem mais pending (ambas têm runs).
    const r3 = await processNextPending(deps);
    expect(r3).toBeNull();
  });

  test("processTask retorna em <2s com mock instantâneo (DoD)", async () => {
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

    const t0 = Date.now();
    await processTask(deps, task);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test("dois workers paralelos: só um pega lease e attempt_n não duplica", async () => {
    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "parallel",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });

    const deps2: RunnerDeps = { ...deps, workerId: "worker-test-2" };
    const [r1, r2] = await Promise.all([processNextPending(deps), processNextPending(deps2)]);
    const processed = [r1, r2].filter((r) => r !== null);

    expect(processed).toHaveLength(1);
    expect(processed[0]?.task.id).toBe(task.id);

    const runs = testDb.db
      .query<{ status: string; attempt_n: number }, [number]>(
        "SELECT status, attempt_n FROM task_runs WHERE task_id = ? ORDER BY attempt_n",
      )
      .all(task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.attempt_n).toBe(1);
  });

  test("401 no SDK dispara refresh 1x e retenta com sucesso", async () => {
    const task = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "auth retry",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [], throwAfter: new Error("401 unauthorized") });
    mockClient.enqueueResponse({ messages: [assistantText("ok after refresh")] });

    let refreshCalls = 0;
    deps = {
      ...deps,
      authRefresh: {
        runSetupToken: async () => {
          refreshCalls += 1;
          return { exitCode: 0, stderr: "" };
        },
      },
    };

    const result = await processTask(deps, task);
    expect(refreshCalls).toBe(1);
    expect(mockClient.invocations).toHaveLength(2);
    expect(result.run.status).toBe("succeeded");
    expect(result.run.result).toContain("ok after refresh");
  });

  test("429 marca quota como esgotada e próxima task normal é deferida", async () => {
    const rateLimitedTask = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "will hit 429",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({
      messages: [],
      throwAfter: new SdkRateLimitError("429 quota exceeded"),
    });

    const first = await processTask(deps, rateLimitedTask);
    expect(first.run.status).toBe("pending");
    expect(first.run.notBefore).not.toBeNull();
    expect(deps.quotaTracker.currentWindow().state).toBe("esgotado");
    expect(deps.eventsRepo.queryByKind("quota_429_observed")).toHaveLength(1);

    const normalTask = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "should defer by exhausted window",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    const second = await processTask(deps, normalTask);
    expect(second.run.status).toBe("pending");
    expect(second.run.notBefore).not.toBeNull();
    expect(deps.eventsRepo.queryByKind("task_deferred").length).toBeGreaterThanOrEqual(1);
  });
});
