import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import { LeaseManager, type RunnerDeps, processNextPending } from "@clawde/worker";
import { type TestDb, makeTestDb } from "../helpers/db.ts";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

describe("worker quota defer with not_before", () => {
  let testDb: TestDb;
  let deps: RunnerDeps;
  let tasksRepo: TasksRepo;
  let runsRepo: TaskRunsRepo;
  let eventsRepo: EventsRepo;
  let quotaTracker: QuotaTracker;
  let quotaRepo: QuotaLedgerRepo;
  let mockClient: MockAgentClient;

  beforeEach(() => {
    testDb = makeTestDb();
    setLogSink(() => {});
    tasksRepo = new TasksRepo(testDb.db);
    runsRepo = new TaskRunsRepo(testDb.db);
    eventsRepo = new EventsRepo(testDb.db);
    quotaRepo = new QuotaLedgerRepo(testDb.db);
    quotaTracker = new QuotaTracker(quotaRepo, DEFAULT_TRACKER_CONFIG);
    mockClient = new MockAgentClient();

    deps = {
      tasksRepo,
      runsRepo,
      eventsRepo,
      leaseManager: new LeaseManager(runsRepo, eventsRepo, {
        leaseSeconds: 60,
        heartbeatSeconds: 999,
      }),
      quotaTracker,
      quotaPolicy: makeQuotaPolicy(),
      agentClient: mockClient,
      logger: createLogger({ component: "quota-defer-test" }),
      workerId: "worker-quota",
    };
  });

  afterEach(() => {
    testDb.cleanup();
    resetLogSink();
  });

  test("esgotado não consome ledger, registra task_deferred e mantém task pending", async () => {
    // Força janela esgotada (capacity max5x = 250).
    const ws = quotaRepo.currentWindowStart();
    quotaRepo.insert({
      msgsConsumed: 1000,
      windowStart: ws,
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    expect(quotaTracker.currentWindow().state).toBe("esgotado");

    const t = tasksRepo.insert({
      priority: "NORMAL",
      prompt: "should defer",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [assistantText("should not run")] });

    const before = quotaTracker.currentWindow().msgsConsumed;
    const result = await processNextPending(deps);
    const after = quotaTracker.currentWindow().msgsConsumed;

    expect(result).not.toBeNull();
    expect(result?.run.status).toBe("pending");
    expect(result?.run.notBefore).not.toBeNull();
    expect(before).toBe(after);

    const deferredEvents = eventsRepo.queryByKind("task_deferred");
    expect(deferredEvents.length).toBe(1);
    expect(deferredEvents[0]?.payload.task_id).toBe(t.id);
  });

  test("defer repetido não gera spam: evento emitido uma vez", async () => {
    const ws = quotaRepo.currentWindowStart();
    quotaRepo.insert({
      msgsConsumed: 1000,
      windowStart: ws,
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    tasksRepo.insert({
      priority: "NORMAL",
      prompt: "defer once",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });

    await processNextPending(deps);
    await processNextPending(deps);
    await processNextPending(deps);

    expect(eventsRepo.queryByKind("task_deferred").length).toBe(1);
  });
});
