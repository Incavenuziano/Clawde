import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSmokeTest } from "@clawde/cli/commands/smoke-test";
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

describe("cli/smoke-test", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-smoke-"));
    dbPath = join(dir, "state.db");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("DB com schema atualizado: exit 0, todos OK", () => {
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);

    const { exit, stdout } = captureOutput(() =>
      runSmokeTest({ dbPath, format: "text" }),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("[OK ] db.integrity_check");
    expect(stdout).toContain("[OK ] db.migrations");
    expect(stdout).toContain("overall: OK");
  });

  test("DB sem migrations aplicadas: exit 1, integrity ok mas migrations FAIL", () => {
    // openDb cria DB vazia sem schema.
    const db = openDb(dbPath);
    closeDb(db);

    const { exit, stdout } = captureOutput(() =>
      runSmokeTest({ dbPath, format: "text" }),
    );
    expect(exit).toBe(1);
    expect(stdout).toContain("[FAIL] db.migrations");
    expect(stdout).toContain("pending: 1");
    expect(stdout).toContain("overall: FAIL");
  });

  test("output JSON parseável", () => {
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);

    const { exit, stdout } = captureOutput(() =>
      runSmokeTest({ dbPath, format: "json" }),
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.checks).toHaveLength(2);
    expect(parsed.checks[0].name).toBe("db.integrity_check");
  });

  test("DB inacessível retorna exit 2 + stderr", () => {
    const { exit, stderr } = captureOutput(() =>
      runSmokeTest({ dbPath: "/nonexistent/dir/state.db", format: "text" }),
    );
    expect(exit).toBe(2);
    expect(stderr).toContain("error opening db");
  });
});
