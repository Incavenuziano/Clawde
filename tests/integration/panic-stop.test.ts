import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PanicStopReport,
  fakeSystemdController,
  runPanicStop,
} from "@clawde/cli/commands/panic";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((c: unknown): boolean => {
    stdout += String(c);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown): boolean => {
    stderr += String(c);
    return true;
  }) as typeof process.stderr.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout, stderr }))
    .finally(() => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    });
}

describe("cli/commands/panic runPanicStop", () => {
  let dir: string;
  let dbPath: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-panic-stop-"));
    dbPath = join(dir, "state.db");
    lockPath = join(dir, "panic.lock");
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("happy path: cria lock, para units, persiste event panic_stop", async () => {
    const sd = fakeSystemdController();
    sd.setActive("clawde-receiver", true);
    sd.setActive("clawde-worker.path", true);

    const { exit, stdout } = await captureOutput(() =>
      runPanicStop({ dbPath, lockPath, format: "json", reason: "incident #42", systemd: sd }),
    );

    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as PanicStopReport;
    expect(report.ok).toBe(true);
    expect(report.alreadyLocked).toBe(false);
    expect(report.lock.reason).toBe("incident #42");
    expect(report.stops.map((s) => s.unit)).toEqual(["clawde-receiver", "clawde-worker.path"]);
    expect(report.stops.every((s) => s.ok)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    expect(sd.calls.map((c) => `${c.op}:${c.unit}`)).toEqual([
      "stop:clawde-receiver",
      "stop:clawde-worker.path",
    ]);

    const db = openDb(dbPath);
    try {
      const rows = db
        .query<{ kind: string; payload: string }, []>(
          "SELECT kind, payload FROM events WHERE kind='panic_stop'",
        )
        .all();
      expect(rows).toHaveLength(1);
      const first = rows[0];
      if (first === undefined)
        throw new Error("unreachable: rows[0] missing after toHaveLength(1)");
      const payload = JSON.parse(first.payload) as Record<string, unknown>;
      expect(payload.reason).toBe("incident #42");
      expect(payload.already_locked).toBe(false);
    } finally {
      closeDb(db);
    }
  });

  test("idempotente: segunda chamada preserva lock original e ainda registra event", async () => {
    const sd = fakeSystemdController();
    await runPanicStop({ dbPath, lockPath, format: "json", reason: "first", systemd: sd });

    const sd2 = fakeSystemdController();
    const { exit, stdout } = await captureOutput(() =>
      runPanicStop({ dbPath, lockPath, format: "json", reason: "second", systemd: sd2 }),
    );

    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as PanicStopReport;
    expect(report.alreadyLocked).toBe(true);
    expect(report.lock.reason).toBe("first");

    const db = openDb(dbPath);
    try {
      const events = new EventsRepo(db);
      const all = events
        .querySince("1970-01-01T00:00:00Z", 100)
        .filter((e) => e.kind === "panic_stop");
      expect(all).toHaveLength(2);
    } finally {
      closeDb(db);
    }
  });

  test("falha em stop produz overall DEGRADED mas exit 0 (idempotente)", async () => {
    const sd = fakeSystemdController();
    sd.failOn("stop", "clawde-receiver", "Failed: unit not loaded.");

    const { exit, stdout } = await captureOutput(() =>
      runPanicStop({ dbPath, lockPath, format: "text", systemd: sd }),
    );

    expect(exit).toBe(0);
    expect(stdout).toContain("[FAIL] systemctl stop clawde-receiver");
    expect(stdout).toContain("Failed: unit not loaded.");
    expect(stdout).toContain("overall: DEGRADED");
  });
});
