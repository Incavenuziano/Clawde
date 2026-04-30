import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PanicResumeReport,
  createPanicLock,
  fakeSystemdController,
  runPanicResume,
} from "@clawde/cli/commands/panic";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
}> {
  const orig = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((c: unknown): boolean => {
    stdout += String(c);
    return true;
  }) as typeof process.stdout.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout }))
    .finally(() => {
      process.stdout.write = orig;
    });
}

describe("cli/commands/panic runPanicResume", () => {
  let dir: string;
  let dbPath: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-panic-resume-"));
    dbPath = join(dir, "state.db");
    lockPath = join(dir, "panic.lock");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("recusa resume quando diagnose retorna warn", async () => {
    createPanicLock(lockPath);
    const sd = fakeSystemdController();
    const { exit, stdout } = await captureOutput(() =>
      runPanicResume({
        dbPath,
        lockPath,
        format: "json",
        systemd: sd,
        diagnose: async () => ({
          subject: "all",
          status: "warn",
          checks: [{ name: "agents.load", status: "warn", detail: "0 agents defined" }],
        }),
      }),
    );
    expect(exit).toBe(1);
    const report = JSON.parse(stdout) as PanicResumeReport;
    expect(report.ok).toBe(false);
    expect(report.lockRemoved).toBe(false);
    expect(report.refusedReason).toContain("status=warn");
    expect(existsSync(lockPath)).toBe(true);
    expect(sd.calls).toHaveLength(0);
  });

  test("recusa resume quando diagnose retorna error", async () => {
    createPanicLock(lockPath);
    const sd = fakeSystemdController();
    const { exit } = await captureOutput(() =>
      runPanicResume({
        dbPath,
        lockPath,
        format: "json",
        systemd: sd,
        diagnose: async () => ({
          subject: "all",
          status: "error",
          checks: [{ name: "db.integrity", status: "error", detail: "corruption" }],
        }),
      }),
    );
    expect(exit).toBe(1);
    expect(existsSync(lockPath)).toBe(true);
  });

  test("happy path: diagnose ok → remove lock + start receiver → exit 0", async () => {
    createPanicLock(lockPath, "previous incident");
    const sd = fakeSystemdController();
    const { exit, stdout } = await captureOutput(() =>
      runPanicResume({
        dbPath,
        lockPath,
        format: "json",
        systemd: sd,
        diagnose: async () => ({
          subject: "all",
          status: "ok",
          checks: [{ name: "db.integrity", status: "ok", detail: "ok" }],
        }),
      }),
    );
    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as PanicResumeReport;
    expect(report.ok).toBe(true);
    expect(report.lockRemoved).toBe(true);
    expect(report.start?.unit).toBe("clawde-receiver");
    expect(report.start?.ok).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
    expect(sd.calls).toEqual([{ op: "start", unit: "clawde-receiver" }]);
  });

  test("retorna exit 2 quando systemctl start falha", async () => {
    createPanicLock(lockPath);
    const sd = fakeSystemdController();
    sd.failOn("start", "clawde-receiver", "Failed to start unit");
    const { exit, stdout } = await captureOutput(() =>
      runPanicResume({
        dbPath,
        lockPath,
        format: "text",
        systemd: sd,
        diagnose: async () => ({
          subject: "all",
          status: "ok",
          checks: [],
        }),
      }),
    );
    expect(exit).toBe(2);
    expect(stdout).toContain("[FAIL] systemctl start clawde-receiver");
    expect(stdout).toContain("Failed to start unit");
    expect(existsSync(lockPath)).toBe(false);
  });
});
