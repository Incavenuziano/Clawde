import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type SessionShowReport,
  runSessionsList,
  runSessionsShow,
} from "@clawde/cli/commands/sessions";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { SessionsRepo } from "@clawde/db/repositories/sessions";

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

describe("cli/commands/sessions list+show", () => {
  let dir: string;
  let dbPath: string;
  let db: ClawdeDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-sessions-cmd-"));
    dbPath = join(dir, "state.db");
    db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  test("list em DB sem sessões retorna stdout '(no sessions)'", async () => {
    const { exit, stdout } = await captureOutput(() => runSessionsList({ dbPath, format: "text" }));
    expect(exit).toBe(0);
    expect(stdout).toContain("(no sessions)");
  });

  test("list em JSON retorna array de sessions ordenadas", async () => {
    const repo = new SessionsRepo(db);
    repo.upsert({ sessionId: "sess-a", agent: "implementer" });
    repo.upsert({ sessionId: "sess-b", agent: "verifier" });
    repo.markUsed("sess-a", 3, 120);

    const { exit, stdout } = await captureOutput(() => runSessionsList({ dbPath, format: "json" }));
    expect(exit).toBe(0);
    const list = JSON.parse(stdout) as Array<{ sessionId: string; msgCount: number }>;
    expect(list).toHaveLength(2);
    // sess-a tem last_used_at; sess-b nunca foi marcada — sess-a deve vir primeiro
    expect(list[0]?.sessionId).toBe("sess-a");
    expect(list[0]?.msgCount).toBe(3);
  });

  test("show retorna detalhes + eventsCount=0 quando sem events", async () => {
    const repo = new SessionsRepo(db);
    repo.upsert({ sessionId: "sess-c", agent: "implementer" });

    const { exit, stdout } = await captureOutput(() =>
      runSessionsShow({ dbPath, format: "json", sessionId: "sess-c" }),
    );
    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as SessionShowReport;
    expect(report.session.sessionId).toBe("sess-c");
    expect(report.session.agent).toBe("implementer");
    expect(report.eventsCount).toBe(0);
    expect(report.warnings).toEqual([]);
  });

  test("show conta events relacionados", async () => {
    const repo = new SessionsRepo(db);
    repo.upsert({ sessionId: "sess-d", agent: "implementer" });
    const events = new EventsRepo(db);
    events.insert({
      taskRunId: null,
      sessionId: "sess-d",
      traceId: null,
      spanId: null,
      kind: "task_start",
      payload: {},
    });
    events.insert({
      taskRunId: null,
      sessionId: "sess-d",
      traceId: null,
      spanId: null,
      kind: "task_finish",
      payload: {},
    });

    const { stdout } = await captureOutput(() =>
      runSessionsShow({ dbPath, format: "json", sessionId: "sess-d" }),
    );
    const report = JSON.parse(stdout) as SessionShowReport;
    expect(report.eventsCount).toBe(2);
  });

  test("show emite warning quando compact_pending há > 7 dias", async () => {
    const repo = new SessionsRepo(db);
    repo.upsert({ sessionId: "sess-e", agent: "implementer" });
    // Force state via SQL pra evitar lógica de validação de transição.
    db.run("UPDATE sessions SET state='compact_pending', last_used_at=? WHERE session_id=?", [
      "2026-01-01 00:00:00",
      "sess-e",
    ]);

    const fixedNow = Date.parse("2026-04-30T00:00:00Z");
    const { stdout } = await captureOutput(() =>
      runSessionsShow({
        dbPath,
        format: "json",
        sessionId: "sess-e",
        nowMs: () => fixedNow,
      }),
    );
    const report = JSON.parse(stdout) as SessionShowReport;
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("compact_pending");
    expect(report.warnings[0]).toContain("7 dias");
  });

  test("show retorna exit 1 + stderr error quando session não existe", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runSessionsShow({ dbPath, format: "text", sessionId: "missing" }),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("not found");
  });
});
