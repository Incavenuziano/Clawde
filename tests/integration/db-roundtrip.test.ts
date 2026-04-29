/**
 * F1.T20 — Integração schema completo + integrity_check.
 *
 * Aplica todas as migrations, popula representativamente todas as tabelas,
 * roda integrity_check, valida queries cross-tabela.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { MemoryRepo } from "@clawde/db/repositories/memory";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { SessionsRepo } from "@clawde/db/repositories/sessions";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { deriveSessionId } from "@clawde/domain/session";

describe("F1.T20 integration: full schema populated + integrity_check", () => {
  let dir: string;
  let db: ClawdeDatabase;
  let tasks: TasksRepo;
  let runs: TaskRunsRepo;
  let sessions: SessionsRepo;
  let events: EventsRepo;
  let quota: QuotaLedgerRepo;
  let memory: MemoryRepo;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-t20-"));
    db = openDb(join(dir, "state.db"));
    applyPending(db, defaultMigrationsDir());
    tasks = new TasksRepo(db);
    runs = new TaskRunsRepo(db);
    sessions = new SessionsRepo(db);
    events = new EventsRepo(db);
    quota = new QuotaLedgerRepo(db);
    memory = new MemoryRepo(db);
  });
  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  test("popula 5 tasks + 10 task_runs + 50 events + 30 observations e roda integrity_check", () => {
    const t0 = Date.now();
    const sessionId = deriveSessionId({ agent: "default", workingDir: "/tmp/clawde" });
    sessions.upsert({ sessionId, agent: "default" });

    // 5 tasks.
    const taskIds: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = tasks.insert({
        priority: ["LOW", "NORMAL", "HIGH", "URGENT", "NORMAL"][i] as "NORMAL",
        prompt: `task ${i}`,
        agent: "default",
        sessionId,
        workingDir: "/tmp/clawde",
        dependsOn: [],
        source: "cli",
        sourceMetadata: { test: true },
        dedupKey: `task-${i}`,
      });
      taskIds.push(t.id);
    }

    // 10 task_runs (2 por task, simulando retry).
    let totalRuns = 0;
    for (const tid of taskIds) {
      const r1 = runs.insert(tid, "worker-host01");
      runs.acquireLease(r1.id, 60);
      runs.transitionStatus(r1.id, "failed", { error: "transient" });

      const r2 = runs.insert(tid, "worker-host01");
      runs.acquireLease(r2.id, 60);
      runs.transitionStatus(r2.id, "succeeded", { result: "ok", msgsConsumed: 1 });
      totalRuns += 2;
    }
    expect(totalRuns).toBe(10);

    // 50 events (5 por run × 10 runs).
    for (let i = 0; i < 50; i++) {
      events.insert({
        taskRunId: null,
        sessionId,
        traceId: `trace-${Math.floor(i / 5)}`,
        spanId: `span-${i}`,
        kind: i % 2 === 0 ? "task_start" : "task_finish",
        payload: { i },
      });
    }

    // 20 quota_ledger entries (na janela ativa).
    const ws = quota.currentWindowStart();
    for (let i = 0; i < 20; i++) {
      quota.insert({
        msgsConsumed: 1,
        windowStart: ws,
        plan: "max5x",
        peakMultiplier: 1.0,
        taskRunId: null,
      });
    }

    // 30 memory_observations (mix observation/lesson).
    for (let i = 0; i < 30; i++) {
      memory.insertObservation({
        sessionId,
        sourceJsonl: null,
        kind: i < 25 ? "observation" : "lesson",
        content: `observation ${i}: padrão de retry funcionou após ${i} tentativas`,
        importance: i < 25 ? 0.5 : 0.85,
        consolidatedInto: null,
      });
    }

    // Integrity check.
    const integrity = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
    expect(integrity?.integrity_check).toBe("ok");

    // Cross-tabela queries:
    // 1. Total task_runs por status.
    const byStatus = db
      .query<{ status: string; n: number }, []>(
        "SELECT status, COUNT(*) AS n FROM task_runs GROUP BY status",
      )
      .all();
    const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
    expect(statusMap.failed).toBe(5);
    expect(statusMap.succeeded).toBe(5);

    // 2. Total quota consumida na janela.
    expect(quota.totalInWindow()).toBe(20);

    // 3. Lessons listadas separadamente.
    const lessons = memory.listByKind("lesson");
    expect(lessons).toHaveLength(5);
    expect(lessons[0]?.importance).toBe(0.85);

    // 4. FTS5 retorna observations relevantes.
    const ftsResults = memory.searchFTS("retry*");
    expect(ftsResults.length).toBeGreaterThan(0);

    // 5. Events por trace.
    const traceEvents = events.queryByTrace("trace-0");
    expect(traceEvents).toHaveLength(5);

    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(3000); // DoD: <2s; pequena margem.
  });

  test("imutabilidade de tasks confirmada com dados reais", () => {
    const t = tasks.insert({
      priority: "NORMAL",
      prompt: "imutável",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    expect(() => db.exec(`UPDATE tasks SET prompt='changed' WHERE id=${t.id}`)).toThrow(
      /immutable/,
    );
  });

  test("events append-only confirmado com dados reais", () => {
    const sessionId = deriveSessionId({ agent: "default", workingDir: "/tmp/clawde" });
    sessions.upsert({ sessionId, agent: "default" });
    const e = events.insert({
      taskRunId: null,
      sessionId,
      traceId: "test",
      spanId: null,
      kind: "enqueue",
      payload: {},
    });
    expect(() => db.exec(`UPDATE events SET kind='changed' WHERE id=${e.id}`)).toThrow(
      /append-only/,
    );
    expect(() => db.exec(`DELETE FROM events WHERE id=${e.id}`)).toThrow(/append-only/);
  });
});
