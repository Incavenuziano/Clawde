import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker } from "@clawde/quota";
import { LeaseManager, makeReconciler, processNextPending } from "@clawde/worker";
import { type TestDb, makeTestDb } from "../helpers/db.ts";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

describe("worker/lease + reconcile integration", () => {
  let testDb: TestDb;
  let tasksRepo: TasksRepo;
  let runsRepo: TaskRunsRepo;
  let eventsRepo: EventsRepo;
  let lease: LeaseManager;
  let taskId: number;

  beforeEach(() => {
    testDb = makeTestDb();
    tasksRepo = new TasksRepo(testDb.db);
    runsRepo = new TaskRunsRepo(testDb.db);
    eventsRepo = new EventsRepo(testDb.db);
    lease = new LeaseManager(runsRepo, eventsRepo, {
      leaseSeconds: 60,
      heartbeatSeconds: 999, // não dispara durante teste
    });
    const t = tasksRepo.insert({
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
    taskId = t.id;
  });
  afterEach(() => testDb.cleanup());

  test("acquire emite task_start event", () => {
    const run = runsRepo.insert(taskId, "w1");
    const acq = lease.acquire(run.id, "trace-1");
    expect(acq).not.toBeNull();
    acq?.stopHeartbeat();

    const events = eventsRepo.queryByTaskRun(run.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("task_start");
    expect(events[0]?.traceId).toBe("trace-1");
  });

  test("acquire em run já running retorna null", () => {
    const run = runsRepo.insert(taskId, "w1");
    const a1 = lease.acquire(run.id);
    a1?.stopHeartbeat();
    const a2 = lease.acquire(run.id);
    expect(a2).toBeNull();
  });

  test("finish succeeded transiciona + emite task_finish", () => {
    const run = runsRepo.insert(taskId, "w1");
    const acq = lease.acquire(run.id);
    if (acq === null) throw new Error("acquire failed");

    const finished = lease.finish(acq, "succeeded", { result: "ok", msgsConsumed: 2 });
    expect(finished.status).toBe("succeeded");

    const events = eventsRepo.queryByTaskRun(run.id);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("task_start");
    expect(kinds).toContain("task_finish");
  });

  test("finish failed emite task_fail com error", () => {
    const run = runsRepo.insert(taskId, "w1");
    const acq = lease.acquire(run.id);
    if (acq === null) throw new Error("acquire failed");

    lease.finish(acq, "failed", { error: "rate_limit" });
    const events = eventsRepo.queryByKind("task_fail");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.error).toBe("rate_limit");
  });

  test("reconcile detecta lease expirado e re-enfileira", () => {
    const run = runsRepo.insert(taskId, "w1");
    // Adquire lease normal e força lease_until no passado via UPDATE direto
    // (mais determinístico que esperar setTimeout).
    runsRepo.acquireLease(run.id, 60);
    testDb.db.exec(
      `UPDATE task_runs SET lease_until = datetime('now', '-10 seconds') WHERE id = ${run.id}`,
    );

    const reconciler = makeReconciler(runsRepo, eventsRepo);
    const result = reconciler.reconcile("worker-host01");

    expect(result.expired).toHaveLength(1);
    expect(result.expired[0]?.id).toBe(run.id);
    expect(result.reenqueued).toHaveLength(1);
    expect(result.reenqueued[0]?.taskId).toBe(taskId);

    // Run original agora abandoned.
    const orig = runsRepo.findById(run.id);
    expect(orig?.status).toBe("abandoned");

    // Novo run com attempt_n=2.
    const latest = runsRepo.findLatestByTaskId(taskId);
    expect(latest?.attemptN).toBe(2);
    expect(latest?.status).toBe("pending");

    // events lease_expired registrado.
    const expiredEvents = eventsRepo.queryByKind("lease_expired");
    expect(expiredEvents).toHaveLength(1);
  });

  test("reconcile sem expired retorna listas vazias", () => {
    const run = runsRepo.insert(taskId, "w1");
    runsRepo.acquireLease(run.id, 60); // ainda válido
    const reconciler = makeReconciler(runsRepo, eventsRepo);
    const result = reconciler.reconcile("worker-host01");
    expect(result.expired).toHaveLength(0);
    expect(result.reenqueued).toHaveLength(0);
  });

  test("lease expirado → reconcile → worker pega retry e attempt 2 termina succeeded", async () => {
    const run = runsRepo.insert(taskId, "w1");
    runsRepo.acquireLease(run.id, 60);
    testDb.db.exec(
      `UPDATE task_runs SET lease_until = datetime('now', '-10 seconds') WHERE id = ${run.id}`,
    );

    const reconciler = makeReconciler(runsRepo, eventsRepo);
    const rec = reconciler.reconcile("worker-host01");
    expect(rec.reenqueued).toHaveLength(1);

    const mockClient = new MockAgentClient();
    mockClient.enqueueResponse({ messages: [assistantText("retry ok")] });
    const deps = {
      tasksRepo,
      runsRepo,
      eventsRepo,
      leaseManager: lease,
      quotaTracker: new QuotaTracker(new QuotaLedgerRepo(testDb.db), DEFAULT_TRACKER_CONFIG),
      agentClient: mockClient,
      logger: createLogger({ component: "lease-reconcile-test" }),
      workerId: "worker-retry",
    };

    const processed = await processNextPending(deps);
    expect(processed).not.toBeNull();
    expect(processed?.run.attemptN).toBe(2);
    expect(processed?.run.status).toBe("succeeded");
  });
});
