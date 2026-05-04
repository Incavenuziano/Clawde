import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runResult } from "@clawde/cli/commands/result";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";

function captureOutput(fn: () => Promise<number>): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((c: unknown) => {
    stdout += String(c);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown) => {
    stderr += String(c);
    return true;
  }) as typeof process.stderr.write;
  return fn()
    .then((exit) => ({ exit, stdout, stderr }))
    .finally(() => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    });
}

/** Insert a minimal task + task_run row bypassing state machine for test fixtures. */
function insertTaskAndRun(
  db: ClawdeDatabase,
  result: string | null,
  status = "succeeded",
): { taskId: number; runId: number } {
  db.run(
    `INSERT INTO tasks (priority, prompt, agent, depends_on, source, source_metadata)
     VALUES ('NORMAL', 'test prompt', 'implementer', '[]', 'cli', '{}')`,
  );
  const taskId = (
    db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get() as { id: number }
  ).id;

  db.run(
    `INSERT INTO task_runs (task_id, worker_id, status, result, msgs_consumed, attempt_n)
     VALUES (?, 'test-worker', ?, ?, 5, 1)`,
    [taskId, status, result],
  );
  const runId = (
    db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get() as { id: number }
  ).id;

  return { taskId, runId };
}

describe("cli/commands/result", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-result-test-"));
    dbPath = join(dir, "state.db");
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("exibe result diretamente do DB quando presente", async () => {
    const db = openDb(dbPath);
    const { taskId } = insertTaskAndRun(db, "Task completed: did the thing.");
    closeDb(db);

    const { exit, stdout } = await captureOutput(() =>
      runResult({ taskId, dbPath, format: "json" }),
    );
    expect(exit).toBe(0);
    const r = JSON.parse(stdout) as { result: string; resultSource: string };
    expect(r.result).toBe("Task completed: did the thing.");
    expect(r.resultSource).toBe("db");
  });

  test("faz fallback para resumo de eventos quando result=NULL", async () => {
    const db = openDb(dbPath);
    const { taskId, runId } = insertTaskAndRun(db, null);
    const events = new EventsRepo(db);
    events.insert({
      taskRunId: runId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "tool_use",
      payload: { tool_name: "Read" },
    });
    events.insert({
      taskRunId: runId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "tool_use",
      payload: { tool_name: "Edit" },
    });
    events.insert({
      taskRunId: runId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "tool_use",
      payload: { tool_name: "Edit" },
    });
    closeDb(db);

    const { exit, stdout } = await captureOutput(() =>
      runResult({ taskId, dbPath, format: "json" }),
    );
    expect(exit).toBe(0);
    const r = JSON.parse(stdout) as { result: string; resultSource: string };
    expect(r.resultSource).toBe("events_summary");
    expect(r.result).toContain("Edit×2");
    expect(r.result).toContain("Read");
  });

  test("retorna exit 1 quando task não existe", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runResult({ taskId: 9999, dbPath, format: "text" }),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("retorna exit 1 quando não há task_run", async () => {
    const db = openDb(dbPath);
    db.run(`INSERT INTO tasks (priority, prompt, agent, depends_on, source, source_metadata)
            VALUES ('NORMAL', 'orphan', 'implementer', '[]', 'cli', '{}')`);
    const taskId = (
      db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get() as { id: number }
    ).id;
    closeDb(db);

    const { exit, stderr } = await captureOutput(() =>
      runResult({ taskId, dbPath, format: "text" }),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("no task_run");
  });

  test("output JSON contém campos estruturados", async () => {
    const db = openDb(dbPath);
    const { taskId } = insertTaskAndRun(db, "done");
    closeDb(db);

    const { exit, stdout } = await captureOutput(() =>
      runResult({ taskId, dbPath, format: "json" }),
    );
    expect(exit).toBe(0);
    const r = JSON.parse(stdout) as Record<string, unknown>;
    expect(r.taskId).toBe(taskId);
    expect(r.status).toBe("succeeded");
    expect(r.msgsConsumed).toBe(5);
    expect(r.result).toBe("done");
  });
});
