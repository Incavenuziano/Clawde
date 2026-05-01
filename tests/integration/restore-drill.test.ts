import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { SessionsRepo } from "@clawde/db/repositories/sessions";
import { deriveSessionId } from "@clawde/domain/session";

function runScript(
  scriptPath: string,
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined>,
): {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const proc = Bun.spawnSync(["bash", scriptPath, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

describe("restore drill integration", () => {
  let dir: string;
  let homeDir: string;
  let weeklyDir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-restore-drill-"));
    homeDir = join(dir, "home");
    weeklyDir = join(homeDir, "backups", "weekly");
    mkdirSync(weeklyDir, { recursive: true });
    dbPath = join(homeDir, "state.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("drill valida restore do snapshot mesmo com DB live alterado depois do backup", () => {
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    const sessions = new SessionsRepo(db);
    const sessionId = deriveSessionId({ agent: "default", workingDir: "/tmp/clawde" });
    sessions.upsert({ sessionId, agent: "default" });

    const events = new EventsRepo(db);
    const quota = new QuotaLedgerRepo(db);
    events.insert({
      taskRunId: null,
      sessionId,
      traceId: "trace-backup",
      spanId: null,
      kind: "enqueue",
      payload: { source: "restore-drill-test" },
    });
    quota.insert({
      msgsConsumed: 1,
      windowStart: quota.currentWindowStart(),
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    db.run("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", [
      sessionId,
      "user",
      "before backup",
    ]);
    closeDb(db);

    const commonEnv = {
      ...(process.env as Record<string, string | undefined>),
      CLAWDE_HOME: homeDir,
      CLAWDE_DB_PATH: dbPath,
    };

    const snapshot = runScript("scripts/backup-snapshot.sh", [weeklyDir], commonEnv);
    expect(snapshot.exitCode).toBe(0);
    expect(existsSync(weeklyDir)).toBe(true);
    expect(readdirSync(weeklyDir).some((n) => n.startsWith("state-") && n.endsWith(".db"))).toBe(
      true,
    );

    // Muta o DB live após o snapshot para garantir que drill compara snapshot vs restore.
    const dbAfter = openDb(dbPath);
    const eventsAfter = new EventsRepo(dbAfter);
    const quotaAfter = new QuotaLedgerRepo(dbAfter);
    eventsAfter.insert({
      taskRunId: null,
      sessionId,
      traceId: "trace-after",
      spanId: null,
      kind: "task_start",
      payload: { source: "post-backup" },
    });
    quotaAfter.insert({
      msgsConsumed: 5,
      windowStart: quotaAfter.currentWindowStart(),
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    dbAfter.run("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", [
      sessionId,
      "assistant",
      "after backup",
    ]);
    closeDb(dbAfter);

    const drill = runScript("scripts/restore-drill.sh", [], commonEnv);
    expect(drill.exitCode).toBe(0);
    expect(drill.stdout).toContain("restore-drill: OK");
  });
});
