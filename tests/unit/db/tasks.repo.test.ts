import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DedupConflictError, JsonCorruptionError, TasksRepo } from "@clawde/db/repositories/tasks";
import type { NewTask } from "@clawde/domain/task";
import { type TestDb, makeTestDb } from "../../helpers/db.ts";

function sampleTask(overrides: Partial<NewTask> = {}): NewTask {
  return {
    priority: "NORMAL",
    prompt: "test prompt",
    agent: "default",
    sessionId: null,
    workingDir: null,
    dependsOn: [],
    source: "cli",
    sourceMetadata: {},
    dedupKey: null,
    ...overrides,
  };
}

describe("repositories/tasks", () => {
  let testDb: TestDb;
  let repo: TasksRepo;

  beforeEach(() => {
    testDb = makeTestDb();
    repo = new TasksRepo(testDb.db);
  });
  afterEach(() => {
    testDb.cleanup();
  });

  test("insert + findById roundtrip", () => {
    const inserted = repo.insert(sampleTask({ prompt: "hello" }));
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.prompt).toBe("hello");
    expect(inserted.createdAt).toMatch(/\d{4}-\d{2}-\d{2}/);

    const found = repo.findById(inserted.id);
    expect(found).toEqual(inserted);
  });

  test("findById retorna null para id inexistente", () => {
    expect(repo.findById(99999)).toBeNull();
  });

  test("dependsOn e sourceMetadata fazem roundtrip via JSON", () => {
    const inserted = repo.insert(
      sampleTask({
        dependsOn: [1, 2, 3],
        sourceMetadata: { user_id: "abc", chat_id: 42 },
      }),
    );
    const found = repo.findById(inserted.id);
    expect(found?.dependsOn).toEqual([1, 2, 3]);
    expect(found?.sourceMetadata).toEqual({ user_id: "abc", chat_id: 42 });
  });

  test("dedupKey UNIQUE — segunda insert com mesma key lança DedupConflictError", () => {
    repo.insert(sampleTask({ dedupKey: "tg-update-42" }));
    expect(() => repo.insert(sampleTask({ dedupKey: "tg-update-42" }))).toThrow(DedupConflictError);
  });

  test("dedupKey null não conflita (NULLs distintos em SQLite)", () => {
    repo.insert(sampleTask({ dedupKey: null }));
    expect(() => repo.insert(sampleTask({ dedupKey: null }))).not.toThrow();
  });

  test("findByDedupKey retorna a task certa", () => {
    repo.insert(sampleTask({ dedupKey: "k1", prompt: "a" }));
    repo.insert(sampleTask({ dedupKey: "k2", prompt: "b" }));
    expect(repo.findByDedupKey("k1")?.prompt).toBe("a");
    expect(repo.findByDedupKey("k2")?.prompt).toBe("b");
    expect(repo.findByDedupKey("missing")).toBeNull();
  });

  test("imutabilidade: trigger bloqueia UPDATE direto", () => {
    const t = repo.insert(sampleTask());
    expect(() => testDb.db.exec(`UPDATE tasks SET prompt='hacked' WHERE id=${t.id}`)).toThrow(
      /immutable/,
    );
  });

  test("findPending ordena por priority depois created_at", async () => {
    repo.insert(sampleTask({ priority: "LOW", prompt: "low-1" }));
    // Pequeno sleep pra garantir created_at distinto.
    await new Promise((r) => setTimeout(r, 1100));
    repo.insert(sampleTask({ priority: "URGENT", prompt: "urgent-1" }));
    await new Promise((r) => setTimeout(r, 1100));
    repo.insert(sampleTask({ priority: "NORMAL", prompt: "normal-1" }));

    const pending = repo.findPending();
    expect(pending.map((t) => t.prompt)).toEqual(["urgent-1", "normal-1", "low-1"]);
  }, 10000);

  test("findPending inclui tasks com latest run em pending", () => {
    const t = repo.insert(sampleTask({ prompt: "with-pending-run" }));
    repo.insert(sampleTask({ prompt: "without-run" }));
    testDb.db.exec(
      `INSERT INTO task_runs (task_id, worker_id, status) VALUES (${t.id}, 'w1', 'pending')`,
    );

    const pending = repo.findPending();
    expect(pending.map((p) => p.prompt)).toEqual(["with-pending-run", "without-run"]);
  });

  test("findPending exclui tasks com latest run não-pending", () => {
    const t = repo.insert(sampleTask({ prompt: "with-succeeded-run" }));
    repo.insert(sampleTask({ prompt: "without-run" }));
    testDb.db.exec(
      `INSERT INTO task_runs (task_id, worker_id, status) VALUES (${t.id}, 'w1', 'succeeded')`,
    );

    const pending = repo.findPending();
    expect(pending.map((p) => p.prompt)).toEqual(["without-run"]);
  });

  test("findPending exclui pending com not_before no futuro", () => {
    const tFuture = repo.insert(sampleTask({ prompt: "future" }));
    const tReady = repo.insert(sampleTask({ prompt: "ready" }));
    testDb.db.exec(
      `INSERT INTO task_runs (task_id, worker_id, status, not_before)
       VALUES (${tFuture.id}, 'w1', 'pending', datetime('now', '+1 hour'))`,
    );
    testDb.db.exec(
      `INSERT INTO task_runs (task_id, worker_id, status, not_before)
       VALUES (${tReady.id}, 'w1', 'pending', datetime('now', '-1 hour'))`,
    );

    const pending = repo.findPending();
    expect(pending.map((p) => p.prompt)).toEqual(["ready"]);
  });

  test("insert com priority URGENT é aceito", () => {
    const t = repo.insert(sampleTask({ priority: "URGENT" }));
    expect(t.priority).toBe("URGENT");
  });

  test("findById lança JsonCorruptionError quando depends_on está corrompido", () => {
    testDb.db.exec("PRAGMA ignore_check_constraints = ON");
    testDb.db.exec(`
      INSERT INTO tasks (priority, prompt, agent, depends_on, source, source_metadata)
      VALUES ('NORMAL', 'p', 'default', '{not-json', 'cli', '{}')
    `);
    const id = (testDb.db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
    testDb.db.exec("PRAGMA ignore_check_constraints = OFF");

    try {
      repo.findById(id);
      throw new Error("expected JsonCorruptionError");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonCorruptionError);
      const typed = error as JsonCorruptionError;
      expect(typed.rowId).toBe(id);
      expect(typed.column).toBe("depends_on");
      expect(typed.rawValue).toBe("{not-json");
    }
  });

  test("findById lança JsonCorruptionError quando source_metadata está corrompido", () => {
    testDb.db.exec("PRAGMA ignore_check_constraints = ON");
    testDb.db.exec(`
      INSERT INTO tasks (priority, prompt, agent, depends_on, source, source_metadata)
      VALUES ('NORMAL', 'p', 'default', '[]', 'cli', '{oops')
    `);
    const id = (testDb.db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
    testDb.db.exec("PRAGMA ignore_check_constraints = OFF");

    try {
      repo.findById(id);
      throw new Error("expected JsonCorruptionError");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonCorruptionError);
      const typed = error as JsonCorruptionError;
      expect(typed.rowId).toBe(id);
      expect(typed.column).toBe("source_metadata");
      expect(typed.rawValue).toBe("{oops");
    }
  });
});
