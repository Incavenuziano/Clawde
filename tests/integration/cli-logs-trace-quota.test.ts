import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "@clawde/cli/main";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
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
  readonly cleanup: () => void;
}

function makeSetup(): Setup {
  const dir = mkdtempSync(join(tmpdir(), "clawde-cli-ltq-"));
  const dbPath = join(dir, "state.db");
  const db = openDb(dbPath);
  applyPending(db, defaultMigrationsDir());
  return {
    db,
    dbPath,
    cleanup: () => {
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("cli logs", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.cleanup());

  test("--task <id> retorna events filtrados", async () => {
    const events = new EventsRepo(setup.db);
    const tasks = new TasksRepo(setup.db);
    const task = tasks.insert({
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
    setup.db.exec(
      `INSERT INTO task_runs (task_id, worker_id, status) VALUES (${task.id}, 'w1', 'pending')`,
    );
    const runId = (setup.db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
    events.insert({
      taskRunId: runId,
      sessionId: null,
      traceId: "01TRACE",
      spanId: null,
      kind: "task_start",
      payload: { hello: 1 },
    });
    events.insert({
      taskRunId: runId,
      sessionId: null,
      traceId: "01TRACE",
      spanId: null,
      kind: "task_finish",
      payload: { hello: 2 },
    });

    const { exit, stdout } = await captureOutput(() =>
      runMain(["logs", "--task", String(runId), "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("[task_start]");
    expect(stdout).toContain("[task_finish]");
  });

  test("--trace retorna events da trace", async () => {
    const events = new EventsRepo(setup.db);
    events.insert({
      taskRunId: null,
      sessionId: null,
      traceId: "01TRACEA",
      spanId: null,
      kind: "enqueue",
      payload: {},
    });
    events.insert({
      taskRunId: null,
      sessionId: null,
      traceId: "01TRACEB",
      spanId: null,
      kind: "enqueue",
      payload: {},
    });

    const { exit, stdout } = await captureOutput(() =>
      runMain(["logs", "--trace", "01TRACEA", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("[enqueue]");
    // Apenas 1 linha (apenas TRACEA).
    const lines = stdout.split("\n").filter((l) => l.includes("[enqueue]"));
    expect(lines).toHaveLength(1);
  });

  test("--kind filtra por kind", async () => {
    const events = new EventsRepo(setup.db);
    events.insert({
      taskRunId: null,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "auth_fail",
      payload: {},
    });
    events.insert({
      taskRunId: null,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "enqueue",
      payload: {},
    });

    const { stdout } = await captureOutput(() =>
      runMain(["logs", "--kind", "auth_fail", "--db", setup.dbPath]),
    );
    expect(stdout).toContain("[auth_fail]");
    expect(stdout).not.toContain("[enqueue]");
  });

  test("sem flag de filtro retorna 1", async () => {
    const { exit, stderr } = await captureOutput(() => runMain(["logs", "--db", setup.dbPath]));
    expect(exit).toBe(1);
    expect(stderr).toContain("at least one of");
  });

  test("--since 1h aceito (formato válido)", async () => {
    const events = new EventsRepo(setup.db);
    events.insert({
      taskRunId: null,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "enqueue",
      payload: {},
    });
    const { exit } = await captureOutput(() =>
      runMain(["logs", "--since", "1h", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
  });

  test("--since formato inválido retorna 1", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runMain(["logs", "--since", "yesterday", "--db", setup.dbPath]),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("invalid --since");
  });

  test("rows corrompidas em payload geram WARN e comando segue com exit 0", async () => {
    setup.db.exec("PRAGMA ignore_check_constraints = ON");
    setup.db.exec(`
      INSERT INTO events (trace_id, kind, payload)
      VALUES ('T-CORRUPT', 'enqueue', '{bad-json')
    `);
    setup.db.exec("PRAGMA ignore_check_constraints = OFF");

    const { exit, stderr } = await captureOutput(() =>
      runMain(["logs", "--trace", "T-CORRUPT", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain("WARN: row ");
    expect(stderr).toContain("corrupted (column payload); skipping");
  });
});

describe("cli trace", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.cleanup());

  test("trace <id> consolida events", async () => {
    const events = new EventsRepo(setup.db);
    events.insert({
      taskRunId: null,
      sessionId: null,
      traceId: "01XYZ",
      spanId: null,
      kind: "enqueue",
      payload: {},
    });
    const { exit, stdout } = await captureOutput(() =>
      runMain(["trace", "01XYZ", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("trace 01XYZ");
    expect(stdout).toContain("[enqueue]");
  });

  test("trace sem id retorna 1", async () => {
    const { exit, stderr } = await captureOutput(() => runMain(["trace", "--db", setup.dbPath]));
    expect(exit).toBe(1);
    expect(stderr).toContain("trace ID required");
  });

  test("trace inexistente retorna 0 com '(no events)'", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runMain(["trace", "01MISSING", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("(no events");
  });
});

describe("cli quota", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.cleanup());

  test("quota status sem ledger retorna estado normal", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runMain(["quota", "status", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("state:");
    expect(stdout).toContain("normal");
    expect(stdout).toContain("plan:");
  });

  test("quota status com ledger reflete consumido", async () => {
    const ledger = new QuotaLedgerRepo(setup.db);
    for (let i = 0; i < 5; i++) {
      ledger.insert({
        msgsConsumed: 1,
        windowStart: ledger.currentWindowStart(),
        plan: "max5x",
        peakMultiplier: 1.0,
        taskRunId: null,
      });
    }
    const { stdout } = await captureOutput(() =>
      runMain(["quota", "status", "--db", setup.dbPath]),
    );
    expect(stdout).toContain("consumed:     5 msgs");
  });

  test("quota history mostra entries recentes", async () => {
    const ledger = new QuotaLedgerRepo(setup.db);
    ledger.insert({
      msgsConsumed: 1,
      windowStart: ledger.currentWindowStart(),
      plan: "max5x",
      peakMultiplier: 1.7,
      taskRunId: null,
    });
    const { exit, stdout } = await captureOutput(() =>
      runMain(["quota", "history", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("peak=1.7x");
  });

  test("quota --output json", async () => {
    const { stdout } = await captureOutput(() =>
      runMain(["quota", "status", "--output", "json", "--db", setup.dbPath]),
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.state).toBe("normal");
    expect(parsed.plan).toBe("max5x");
  });

  test("quota action desconhecida retorna 1", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runMain(["quota", "wat", "--db", setup.dbPath]),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("unknown quota action");
  });
});
