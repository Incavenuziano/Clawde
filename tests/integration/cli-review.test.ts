import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "@clawde/cli/main";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: unknown): boolean => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout, stderr }))
    .finally(() => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    });
}

interface Setup {
  readonly db: ClawdeDatabase;
  readonly dbPath: string;
  readonly taskRunId: number;
  readonly cleanup: () => void;
}

function makeSetup(): Setup {
  const dir = mkdtempSync(join(tmpdir(), "clawde-cli-rev-"));
  const dbPath = join(dir, "state.db");
  const db = openDb(dbPath);
  applyPending(db, defaultMigrationsDir());
  const tasksRepo = new TasksRepo(db);
  const runsRepo = new TaskRunsRepo(db);
  const task = tasksRepo.insert({
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
  const run = runsRepo.insert(task.id, "worker-1");
  return {
    db,
    dbPath,
    taskRunId: run.id,
    cleanup: () => {
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("cli review history", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.cleanup());

  test("retorna mensagem amigável quando não há review events", async () => {
    const out = await captureOutput(() =>
      runMain(["review", "history", String(setup.taskRunId), "--db", setup.dbPath]),
    );
    expect(out.exit).toBe(0);
    expect(out.stdout).toContain("(no review events");
  });

  test("lista eventos review.* na ordem cronológica", async () => {
    const repo = new EventsRepo(setup.db);
    repo.insert({
      taskRunId: setup.taskRunId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "review.implementer.start",
      payload: { attempt_n: 1 },
    });
    repo.insert({
      taskRunId: setup.taskRunId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "review.spec.verdict",
      payload: { attempt_n: 1, verdict: "APPROVED" },
    });
    repo.insert({
      taskRunId: setup.taskRunId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "review.pipeline.complete",
      payload: { rounds: 1 },
    });
    // Evento não-review deve ser filtrado:
    repo.insert({
      taskRunId: setup.taskRunId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "task_start",
      payload: {},
    });

    const out = await captureOutput(() =>
      runMain(["review", "history", String(setup.taskRunId), "--db", setup.dbPath]),
    );
    expect(out.exit).toBe(0);
    expect(out.stdout).toContain("review.implementer.start");
    expect(out.stdout).toContain("review.spec.verdict");
    expect(out.stdout).toContain("verdict=APPROVED");
    expect(out.stdout).toContain("attempt=1");
    expect(out.stdout).toContain("review.pipeline.complete");
    expect(out.stdout).not.toContain("task_start");
  });

  test("output JSON contém apenas eventos review.*", async () => {
    const repo = new EventsRepo(setup.db);
    repo.insert({
      taskRunId: setup.taskRunId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "review.spec.verdict",
      payload: { verdict: "REJECTED" },
    });
    repo.insert({
      taskRunId: setup.taskRunId,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "lease_expired",
      payload: {},
    });

    const out = await captureOutput(() =>
      runMain([
        "review",
        "history",
        String(setup.taskRunId),
        "--db",
        setup.dbPath,
        "--output",
        "json",
      ]),
    );
    expect(out.exit).toBe(0);
    const parsed = JSON.parse(out.stdout) as {
      taskRunId: number;
      events: Array<{ kind: string }>;
    };
    expect(parsed.taskRunId).toBe(setup.taskRunId);
    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0]?.kind).toBe("review.spec.verdict");
  });

  test("exit 1 quando run-id ausente", async () => {
    const out = await captureOutput(() => runMain(["review", "history"]));
    expect(out.exit).toBe(1);
    expect(out.stderr).toContain("task_run id required");
  });

  test("exit 1 quando run-id não-numérico", async () => {
    const out = await captureOutput(() => runMain(["review", "history", "abc"]));
    expect(out.exit).toBe(1);
    expect(out.stderr).toContain("invalid run-id");
  });

  test("exit 1 em action desconhecida", async () => {
    const out = await captureOutput(() => runMain(["review", "wat"]));
    expect(out.exit).toBe(1);
    expect(out.stderr).toContain("unknown review action");
  });
});
