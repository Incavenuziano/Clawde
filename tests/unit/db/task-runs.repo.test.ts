import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { InvalidTransitionError } from "@clawde/state";
import { makeTestDb, type TestDb } from "../../helpers/db.ts";

describe("repositories/task-runs", () => {
  let testDb: TestDb;
  let tasksRepo: TasksRepo;
  let runsRepo: TaskRunsRepo;
  let taskId: number;

  beforeEach(() => {
    testDb = makeTestDb();
    tasksRepo = new TasksRepo(testDb.db);
    runsRepo = new TaskRunsRepo(testDb.db);
    taskId = tasksRepo.insert({
      priority: "NORMAL",
      prompt: "test",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    }).id;
  });
  afterEach(() => testDb.cleanup());

  test("insert cria task_run em status pending com attempt_n=1", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    expect(run.taskId).toBe(taskId);
    expect(run.status).toBe("pending");
    expect(run.attemptN).toBe(1);
    expect(run.workerId).toBe("worker-a");
    expect(run.leaseUntil).toBeNull();
  });

  test("insert subsequente para mesmo task incrementa attempt_n", () => {
    runsRepo.insert(taskId, "worker-a");
    const run2 = runsRepo.insert(taskId, "worker-b");
    expect(run2.attemptN).toBe(2);
  });

  test("acquireLease transiciona pending → running e seta lease_until", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    const acquired = runsRepo.acquireLease(run.id, 60);
    expect(acquired).not.toBeNull();
    expect(acquired?.status).toBe("running");
    expect(acquired?.leaseUntil).not.toBeNull();
    expect(acquired?.startedAt).not.toBeNull();
  });

  test("acquireLease retorna null se já não está em pending (idempotência sob concorrência)", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    runsRepo.acquireLease(run.id, 60);
    const second = runsRepo.acquireLease(run.id, 60);
    expect(second).toBeNull();
  });

  test("heartbeat estende lease_until só em running", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    runsRepo.acquireLease(run.id, 60);
    const hb1 = runsRepo.heartbeat(run.id, 120);
    expect(hb1).toBe(true);
  });

  test("heartbeat em pending não tem efeito", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    expect(runsRepo.heartbeat(run.id, 60)).toBe(false);
  });

  test("transitionStatus running → succeeded limpa lease e seta finished_at + result", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    runsRepo.acquireLease(run.id, 60);
    const finished = runsRepo.transitionStatus(run.id, "succeeded", {
      result: "ok",
      msgsConsumed: 3,
    });
    expect(finished.status).toBe("succeeded");
    expect(finished.leaseUntil).toBeNull();
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.result).toBe("ok");
    expect(finished.msgsConsumed).toBe(3);
  });

  test("transitionStatus inválida lança InvalidTransitionError", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    // pending → succeeded é inválido (precisa passar por running)
    expect(() => runsRepo.transitionStatus(run.id, "succeeded")).toThrow(InvalidTransitionError);
  });

  test("transitionStatus running → failed registra error", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    runsRepo.acquireLease(run.id, 60);
    const failed = runsRepo.transitionStatus(run.id, "failed", { error: "boom" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");
  });

  test("transitionStatus running → abandoned permite retry via attempt_n+1", () => {
    const run = runsRepo.insert(taskId, "worker-a");
    runsRepo.acquireLease(run.id, 60);
    runsRepo.transitionStatus(run.id, "abandoned");

    const retry = runsRepo.insert(taskId, "worker-b");
    expect(retry.attemptN).toBe(2);
    expect(retry.status).toBe("pending");
  });

  test("findExpiredLeases retorna runs com lease_until < now", async () => {
    const run = runsRepo.insert(taskId, "worker-a");
    // Lease de 1 segundo, expira logo.
    runsRepo.acquireLease(run.id, 1);
    await new Promise((r) => setTimeout(r, 1500));
    const expired = runsRepo.findExpiredLeases();
    expect(expired.length).toBe(1);
    expect(expired[0]?.id).toBe(run.id);
  });

  test("findExpiredLeases não retorna runs em pending nem succeeded", () => {
    runsRepo.insert(taskId, "w-pending");
    const t2 = tasksRepo.insert({
      priority: "NORMAL",
      prompt: "t2",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    const r2 = runsRepo.insert(t2.id, "w-done");
    runsRepo.acquireLease(r2.id, 60);
    runsRepo.transitionStatus(r2.id, "succeeded");

    expect(runsRepo.findExpiredLeases()).toHaveLength(0);
  });

  test("findLatestByTaskId retorna o de maior attempt_n", () => {
    runsRepo.insert(taskId, "w1"); // attempt 1
    const second = runsRepo.insert(taskId, "w2"); // attempt 2
    expect(runsRepo.findLatestByTaskId(taskId)?.id).toBe(second.id);
  });

  test("UNIQUE (task_id, attempt_n) protegido pelo schema", () => {
    runsRepo.insert(taskId, "w1");
    expect(() =>
      testDb.db.exec(
        `INSERT INTO task_runs (task_id, attempt_n, worker_id, status)
         VALUES (${taskId}, 1, 'w-dup', 'pending')`,
      ),
    ).toThrow(/UNIQUE/);
  });
});
