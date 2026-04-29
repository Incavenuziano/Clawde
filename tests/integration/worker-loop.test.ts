/**
 * T-008 followup: runProcessLoop break-on-defer + max-tasks ceiling.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import { LeaseManager, type RunnerDeps } from "@clawde/worker";
import { runProcessLoop } from "@clawde/worker/main";
import { type TestDb, makeTestDb } from "../helpers/db.ts";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

describe("worker runProcessLoop", () => {
  let testDb: TestDb;
  let deps: RunnerDeps;
  let tasksRepo: TasksRepo;
  let runsRepo: TaskRunsRepo;
  let quotaRepo: QuotaLedgerRepo;
  let mockClient: MockAgentClient;

  beforeEach(() => {
    testDb = makeTestDb();
    setLogSink(() => {});
    tasksRepo = new TasksRepo(testDb.db);
    runsRepo = new TaskRunsRepo(testDb.db);
    const eventsRepo = new EventsRepo(testDb.db);
    quotaRepo = new QuotaLedgerRepo(testDb.db);
    const tracker = new QuotaTracker(quotaRepo, DEFAULT_TRACKER_CONFIG);
    mockClient = new MockAgentClient();
    deps = {
      tasksRepo,
      runsRepo,
      eventsRepo,
      leaseManager: new LeaseManager(runsRepo, eventsRepo, {
        leaseSeconds: 60,
        heartbeatSeconds: 999,
      }),
      quotaTracker: tracker,
      quotaPolicy: makeQuotaPolicy(),
      agentClient: mockClient,
      logger: createLogger({ component: "loop-test" }),
      workerId: "worker-loop",
    };
  });
  afterEach(() => {
    testDb.cleanup();
    resetLogSink();
  });

  function insertTask(prompt: string): void {
    tasksRepo.insert({
      priority: "NORMAL",
      prompt,
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
  }

  test("fila vazia retorna exitReason=empty, processed=0", async () => {
    const result = await runProcessLoop(deps, 50);
    expect(result.processed).toBe(0);
    expect(result.exitReason).toBe("empty");
  });

  test("processa todas até maxTasks=1 e retorna max_tasks quando há mais", async () => {
    insertTask("a");
    insertTask("b");
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });

    const result = await runProcessLoop(deps, 1);
    expect(result.processed).toBe(1);
    expect(result.exitReason).toBe("max_tasks");
  });

  test("primeira task deferida quebra o loop antes de tocar a segunda", async () => {
    // quota esgotada antes do loop começar
    quotaRepo.insert({
      msgsConsumed: 1000,
      windowStart: quotaRepo.currentWindowStart(),
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    insertTask("first");
    insertTask("second");

    const result = await runProcessLoop(deps, 50);
    expect(result.exitReason).toBe("deferred");
    expect(result.processed).toBe(0);

    // Apenas a primeira task ganhou not_before; a segunda continua sem run.
    const firstRun = runsRepo.findLatestByTaskId(1);
    const secondRun = runsRepo.findLatestByTaskId(2);
    expect(firstRun?.notBefore).not.toBeNull();
    expect(secondRun).toBeNull();
  });
});
