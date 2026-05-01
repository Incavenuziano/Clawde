import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvents } from "@clawde/cli/commands/events";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";

function captureOutput(fn: () => number): { exit: number; stdout: string; stderr: string } {
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
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
  try {
    const exit = fn();
    return { exit, stdout, stderr };
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
  }
}

describe("cli/commands/events", () => {
  let dir: string;
  let dbPath: string;
  let prevHomeEnv: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-events-"));
    dbPath = join(dir, "state.db");
    prevHomeEnv = process.env.HOME;
    process.env.HOME = dir;

    const db = openDb(dbPath);
    try {
      applyPending(db, defaultMigrationsDir());
      db.exec(`
        INSERT INTO events (ts, kind, payload)
        VALUES
          ('2020-01-10T00:00:00Z', 'enqueue', '{"old":true}'),
          ('2020-02-10T00:00:00Z', 'task_start', '{"old":true}'),
          ('2099-01-01T00:00:00Z', 'task_finish', '{"future":true}')
      `);
    } finally {
      closeDb(db);
    }
  });

  afterEach(() => {
    if (prevHomeEnv !== undefined) {
      process.env.HOME = prevHomeEnv;
    } else {
      process.env.HOME = undefined;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("export grava JSONL com rows antigas do cutoff", () => {
    const out = captureOutput(() =>
      runEvents({
        action: "export",
        dbPath,
        format: "json",
        sinceCutoff: "90d",
      }),
    );
    expect(out.exit).toBe(0);

    const parsed = JSON.parse(out.stdout) as {
      outputPath: string;
      exported: number;
      sinceCutoff: string;
    };
    expect(parsed.sinceCutoff).toBe("90d");
    expect(parsed.exported).toBe(2);
    expect(existsSync(parsed.outputPath)).toBe(true);

    const lines = readFileSync(parsed.outputPath, "utf-8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { kind: string; payload: Record<string, unknown> });

    expect(lines).toHaveLength(2);
    expect(lines[0]?.kind).toBe("enqueue");
    expect(lines[1]?.kind).toBe("task_start");
    expect(lines[0]?.payload.old).toBe(true);
  });

  test("purge exige --confirm", () => {
    const out = captureOutput(() =>
      runEvents({
        action: "purge",
        dbPath,
        format: "text",
        before: "2020-02-01",
        confirm: false,
      }),
    );
    expect(out.exit).toBe(1);
    expect(out.stderr).toContain("--confirm required");
  });

  test("purge remove rows anteriores à data e limpa retention grant", () => {
    const out = captureOutput(() =>
      runEvents({
        action: "purge",
        dbPath,
        format: "json",
        before: "2020-02-01",
        confirm: true,
      }),
    );
    expect(out.exit).toBe(0);
    const parsed = JSON.parse(out.stdout) as { before: string; deleted: number };
    expect(parsed.before).toBe("2020-02-01");
    expect(parsed.deleted).toBe(1);

    const db = openDb(dbPath);
    try {
      const count = (
        db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get() as { n: number }
      ).n;
      expect(count).toBe(2);
      const grantCount = (
        db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM _retention_grant").get() as {
          n: number;
        }
      ).n;
      expect(grantCount).toBe(0);
    } finally {
      closeDb(db);
    }
  });

  test("purge é idempotente (segunda execução deleta 0)", () => {
    const first = captureOutput(() =>
      runEvents({
        action: "purge",
        dbPath,
        format: "json",
        before: "2020-02-01",
        confirm: true,
      }),
    );
    expect(first.exit).toBe(0);

    const second = captureOutput(() =>
      runEvents({
        action: "purge",
        dbPath,
        format: "json",
        before: "2020-02-01",
        confirm: true,
      }),
    );
    expect(second.exit).toBe(0);
    const parsed = JSON.parse(second.stdout) as { deleted: number };
    expect(parsed.deleted).toBe(0);
  });
});
