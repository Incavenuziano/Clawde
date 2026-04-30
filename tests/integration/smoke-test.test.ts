import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSmokeTest } from "@clawde/cli/commands/smoke-test";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
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
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout, stderr }))
    .finally(() => {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    });
}

describe("cli/smoke-test", () => {
  let dir: string;
  let dbPath: string;
  let prevConfigEnv: string | undefined;
  let prevHomeEnv: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-smoke-"));
    dbPath = join(dir, "state.db");
    const configPath = join(dir, "clawde.toml");
    writeFileSync(configPath, `[clawde]\nhome = "${dir}"\nlog_level = "INFO"\n`, "utf-8");
    prevConfigEnv = process.env.CLAWDE_CONFIG;
    prevHomeEnv = process.env.HOME;
    process.env.CLAWDE_CONFIG = configPath;
  });
  afterEach(() => {
    if (prevConfigEnv !== undefined) {
      process.env.CLAWDE_CONFIG = prevConfigEnv;
    } else {
      process.env.CLAWDE_CONFIG = undefined;
    }
    if (prevHomeEnv !== undefined) {
      process.env.HOME = prevHomeEnv;
    } else {
      process.env.HOME = undefined;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("DB com schema atualizado: exit 0, todos OK", async () => {
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);

    const { exit, stdout } = await captureOutput(() => runSmokeTest({ dbPath, format: "text" }));
    expect(exit).toBe(0);
    expect(stdout).toContain("[OK ] db.integrity_check");
    expect(stdout).toContain("[OK ] db.migrations");
    expect(stdout).toContain("[OK ] worker.dry_run");
    expect(stdout).toContain("[OK ] auth.oauth_expiry");
    expect(stdout).toContain("overall: OK");
  });

  test("DB sem migrations aplicadas: exit 1, integrity ok mas migrations FAIL", async () => {
    // openDb cria DB vazia sem schema.
    const db = openDb(dbPath);
    closeDb(db);

    const { exit, stdout } = await captureOutput(() => runSmokeTest({ dbPath, format: "text" }));
    expect(exit).toBe(1);
    expect(stdout).toContain("[FAIL] db.migrations");
    expect(stdout).toContain("pending: 1");
    expect(stdout).toContain("overall: FAIL");
  });

  test("output JSON parseável", async () => {
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);

    const { exit, stdout } = await captureOutput(() => runSmokeTest({ dbPath, format: "json" }));
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.length).toBeGreaterThanOrEqual(5);
    expect(parsed.checks[0].name).toBe("db.integrity_check");
  });

  test("DB inacessível retorna exit 2 + stderr", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runSmokeTest({ dbPath: "/nonexistent/dir/state.db", format: "text" }),
    );
    expect(exit).toBe(2);
    expect(stderr).toContain("error opening db");
  });

  test("--receiver-url ausente (porta morta) → check FAIL", async () => {
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);

    const { exit, stdout } = await captureOutput(() =>
      runSmokeTest({
        dbPath,
        format: "text",
        receiverUrl: "http://127.0.0.1:1",
        receiverTimeoutMs: 200,
      }),
    );
    expect(exit).toBe(1);
    expect(stdout).toContain("[FAIL] receiver.health");
  });

  test("--include-sdk-ping sem token não falha (skip)", async () => {
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);

    const envBak = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = undefined;
    try {
      const { exit, stdout } = await captureOutput(() =>
        runSmokeTest({ dbPath, format: "text", includeSdkPing: true }),
      );
      expect(exit).toBe(0);
      expect(stdout).toContain("[OK ] sdk.real_ping: skipped (token missing)");
    } finally {
      if (envBak !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = envBak;
    }
  });

  test("não acopla em config global implícita do HOME", async () => {
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);

    const fakeHome = mkdtempSync(join(tmpdir(), "clawde-smoke-home-"));
    try {
      const badConfigDir = join(fakeHome, ".clawde", "config");
      mkdirSync(badConfigDir, { recursive: true });
      writeFileSync(join(badConfigDir, "clawde.toml"), "clawde = [broken", "utf-8");
      process.env.HOME = fakeHome;
      process.env.CLAWDE_CONFIG = undefined;

      const { exit, stdout } = await captureOutput(() => runSmokeTest({ dbPath, format: "text" }));
      expect(exit).toBe(0);
      expect(stdout).toContain("[OK ] worker.dry_run");
      expect(stdout).toContain("overall: OK");
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
