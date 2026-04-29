import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import type { NewEvent } from "@clawde/domain/event";
import { type TestDb, makeTestDb } from "../../helpers/db.ts";

function sample(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    taskRunId: null,
    sessionId: null,
    traceId: null,
    spanId: null,
    kind: "enqueue",
    payload: {},
    ...overrides,
  };
}

describe("repositories/events", () => {
  let testDb: TestDb;
  let repo: EventsRepo;

  beforeEach(() => {
    testDb = makeTestDb();
    repo = new EventsRepo(testDb.db);
  });
  afterEach(() => testDb.cleanup());

  test("insert + retorno tem id e ts", () => {
    const e = repo.insert(sample({ kind: "task_start", payload: { taskId: 1 } }));
    expect(e.id).toBeGreaterThan(0);
    expect(e.ts).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(e.kind).toBe("task_start");
    expect(e.payload).toEqual({ taskId: 1 });
  });

  test("UPDATE em events bloqueado por trigger", () => {
    const e = repo.insert(sample());
    expect(() => testDb.db.exec(`UPDATE events SET kind='changed' WHERE id=${e.id}`)).toThrow(
      /append-only/,
    );
  });

  test("DELETE em events bloqueado sem _retention_grant", () => {
    const e = repo.insert(sample());
    expect(() => testDb.db.exec(`DELETE FROM events WHERE id=${e.id}`)).toThrow(/append-only/);
  });

  test("DELETE permitido quando _retention_grant tem linha", () => {
    const e = repo.insert(sample());
    testDb.db.exec("INSERT INTO _retention_grant (id) VALUES (1)");
    expect(() => testDb.db.exec(`DELETE FROM events WHERE id=${e.id}`)).not.toThrow();
  });

  test("queryByTrace filtra e ordena", () => {
    repo.insert(sample({ traceId: "t1", kind: "enqueue" }));
    repo.insert(sample({ traceId: "t1", kind: "task_start" }));
    repo.insert(sample({ traceId: "t2", kind: "enqueue" }));

    const t1 = repo.queryByTrace("t1");
    expect(t1).toHaveLength(2);
    expect(t1.map((e) => e.kind)).toEqual(["enqueue", "task_start"]);
  });

  test("queryByTaskRun filtra por task_run_id", () => {
    // Pra ter um task_run_id válido (FK), insere task + run.
    testDb.db.exec(`INSERT INTO tasks (priority, prompt, source) VALUES ('NORMAL', 'p', 'cli')`);
    const taskId = (testDb.db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
    testDb.db.exec(
      `INSERT INTO task_runs (task_id, worker_id, status) VALUES (${taskId}, 'w1', 'pending')`,
    );
    const runId = (testDb.db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;

    repo.insert(sample({ taskRunId: runId, kind: "task_start" }));
    repo.insert(sample({ taskRunId: runId, kind: "task_finish" }));
    repo.insert(sample({ taskRunId: null, kind: "enqueue" }));

    const events = repo.queryByTaskRun(runId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind)).toEqual(["task_start", "task_finish"]);
  });

  test("queryByKind retorna mais recentes primeiro (DESC)", async () => {
    repo.insert(sample({ kind: "task_start", payload: { n: 1 } }));
    await new Promise((r) => setTimeout(r, 1100));
    repo.insert(sample({ kind: "task_start", payload: { n: 2 } }));

    const events = repo.queryByKind("task_start");
    expect(events).toHaveLength(2);
    expect(events[0]?.payload.n).toBe(2);
    expect(events[1]?.payload.n).toBe(1);
  }, 5000);

  test("payload faz roundtrip JSON com aninhamento", () => {
    const e = repo.insert(
      sample({
        kind: "tool_use",
        payload: {
          tool: "Bash",
          input: { command: "ls -la" },
          metadata: { sandbox: 2 },
        },
      }),
    );
    expect(e.payload).toEqual({
      tool: "Bash",
      input: { command: "ls -la" },
      metadata: { sandbox: 2 },
    });
  });
});
