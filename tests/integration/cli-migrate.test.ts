import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrate } from "@clawde/cli/commands/migrate";

/**
 * Captura stdout/stderr durante uma chamada (para inspecionar JSON output).
 */
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

describe("cli/commands/migrate", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-cli-mig-"));
    dbPath = join(dir, "state.db");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("up em DB virgem aplica migration 001", () => {
    const { exit, stdout } = captureOutput(() =>
      runMigrate({ action: "up", dbPath, format: "text" }),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("applied: 1");
  });

  test("up rerun retorna 0 e indica nada pendente", () => {
    runMigrate({ action: "up", dbPath, format: "text" });
    const { exit, stdout } = captureOutput(() =>
      runMigrate({ action: "up", dbPath, format: "text" }),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("no migrations pending");
  });

  test("status retorna current/latest/pending", () => {
    runMigrate({ action: "up", dbPath, format: "text" });
    const { exit, stdout } = captureOutput(() =>
      runMigrate({ action: "status", dbPath, format: "text" }),
    );
    expect(exit).toBe(0);
    expect(stdout).toMatch(/current: \d+/);
    expect(stdout).toMatch(/latest: +\d+/);
    expect(stdout).toContain("pending: (none)");
  });

  test("--output json produz JSON parseável", () => {
    runMigrate({ action: "up", dbPath, format: "json" });
    const { exit, stdout } = captureOutput(() =>
      runMigrate({ action: "status", dbPath, format: "json" }),
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.current).toBeGreaterThanOrEqual(1);
    expect(parsed.latest).toBe(parsed.current);
    expect(parsed.pending).toEqual([]);
  });

  test("down sem --confirm retorna exit 1", () => {
    runMigrate({ action: "up", dbPath, format: "text" });
    const { exit, stderr } = captureOutput(() =>
      runMigrate({ action: "down", dbPath, format: "text", target: 0, confirm: false }),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("--confirm required");
  });

  test("down --confirm reverte até target", () => {
    runMigrate({ action: "up", dbPath, format: "text" });
    const { exit, stdout } = captureOutput(() =>
      runMigrate({ action: "down", dbPath, format: "text", target: 0, confirm: true }),
    );
    expect(exit).toBe(0);
    expect(stdout).toMatch(/reverted: [\d, ]+/);
  });

  test("erro de DB retorna exit 2 e stderr", () => {
    // dbPath em diretório que não existe → fs error.
    const badPath = "/nonexistent/dir/state.db";
    const { exit, stderr } = captureOutput(() =>
      runMigrate({ action: "up", dbPath: badPath, format: "text" }),
    );
    expect(exit).toBe(2);
    expect(stderr).toContain("error:");
  });

  test("status com auditoria sem allowlist retorna 0", () => {
    const agentsRoot = join(dir, ".claude", "agents");
    mkdirSync(join(agentsRoot, "default"), { recursive: true });
    writeFileSync(
      join(agentsRoot, "default", "sandbox.toml"),
      ["level = 1", 'network = "none"'].join("\n"),
      "utf-8",
    );

    runMigrate({ action: "up", dbPath, format: "text" });
    const { exit, stderr } = captureOutput(() =>
      runMigrate({
        action: "status",
        dbPath,
        format: "text",
        agentsRoot,
        auditSandboxAllowlist: true,
      }),
    );
    expect(exit).toBe(0);
    expect(stderr).not.toContain("network='allowlist'");
  });

  test("status com auditoria e fail-on-allowlist retorna 2 quando encontra allowlist", () => {
    const agentsRoot = join(dir, ".claude", "agents");
    mkdirSync(join(agentsRoot, "telegram-bot"), { recursive: true });
    writeFileSync(
      join(agentsRoot, "telegram-bot", "sandbox.toml"),
      ["level = 3", 'network = "allowlist"'].join("\n"),
      "utf-8",
    );

    runMigrate({ action: "up", dbPath, format: "text" });
    const { exit, stderr } = captureOutput(() =>
      runMigrate({
        action: "status",
        dbPath,
        format: "text",
        agentsRoot,
        auditSandboxAllowlist: true,
        failOnSandboxAllowlist: true,
      }),
    );
    expect(exit).toBe(2);
    expect(stderr).toContain("network='allowlist'");
    expect(stderr).toContain("telegram-bot");
  });
});
