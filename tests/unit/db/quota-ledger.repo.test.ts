import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QuotaLedgerRepo, roundToHour } from "@clawde/db/repositories/quota-ledger";
import { type TestDb, makeTestDb } from "../../helpers/db.ts";

describe("repositories/quota-ledger roundToHour", () => {
  test("arredonda minutos/segundos pra hora cheia UTC", () => {
    const d = new Date("2026-04-29T14:37:42.123Z");
    expect(roundToHour(d)).toBe("2026-04-29 14:00:00");
  });

  test("já em hora cheia preserva", () => {
    const d = new Date("2026-04-29T15:00:00.000Z");
    expect(roundToHour(d)).toBe("2026-04-29 15:00:00");
  });
});

describe("repositories/quota-ledger", () => {
  let testDb: TestDb;
  let repo: QuotaLedgerRepo;

  beforeEach(() => {
    testDb = makeTestDb();
    repo = new QuotaLedgerRepo(testDb.db);
  });
  afterEach(() => testDb.cleanup());

  test("insert + roundtrip", () => {
    const e = repo.insert({
      msgsConsumed: 1,
      windowStart: "2026-04-29 10:00:00",
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    expect(e.id).toBeGreaterThan(0);
    expect(e.msgsConsumed).toBe(1);
    expect(e.plan).toBe("max5x");
  });

  test("totalInWindow soma entries em janela ativa", () => {
    const now = new Date("2026-04-29T15:30:00.000Z");
    const ws = roundToHour(now);
    repo.insert({
      msgsConsumed: 2,
      windowStart: ws,
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    repo.insert({
      msgsConsumed: 3,
      windowStart: ws,
      plan: "max5x",
      peakMultiplier: 1.7,
      taskRunId: null,
    });

    expect(repo.totalInWindow(now)).toBe(5);
  });

  test("totalInWindow ignora entries fora da janela 5h", () => {
    const now = new Date("2026-04-29T15:30:00.000Z");
    const oldWs = "2026-04-29 09:00:00"; // > 5h atrás
    const newWs = roundToHour(now);

    repo.insert({
      msgsConsumed: 100,
      windowStart: oldWs,
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    repo.insert({
      msgsConsumed: 5,
      windowStart: newWs,
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });

    expect(repo.totalInWindow(now)).toBe(5);
  });

  test("totalInWindow inclui entries exatamente na borda (>=)", () => {
    const now = new Date("2026-04-29T15:00:00.000Z");
    const borderline = "2026-04-29 10:00:00"; // exatamente 5h atrás
    repo.insert({
      msgsConsumed: 7,
      windowStart: borderline,
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });

    expect(repo.totalInWindow(now)).toBe(7);
  });

  test("currentWindowStart retorna hora cheia atual", () => {
    const now = new Date("2026-04-29T15:42:13.000Z");
    expect(repo.currentWindowStart(now)).toBe("2026-04-29 15:00:00");
  });

  test("findRecent retorna por ts DESC", () => {
    repo.insert({
      msgsConsumed: 1,
      windowStart: "2026-04-29 10:00:00",
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    repo.insert({
      msgsConsumed: 2,
      windowStart: "2026-04-29 10:00:00",
      plan: "max5x",
      peakMultiplier: 1.0,
      taskRunId: null,
    });
    const recent = repo.findRecent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.msgsConsumed).toBe(2); // último inserido primeiro
  });

  test("totalInWindow vazio retorna 0 (não null)", () => {
    expect(repo.totalInWindow()).toBe(0);
  });

  test("plan inválido rejeitado pelo CHECK constraint", () => {
    expect(() =>
      testDb.db.exec(
        `INSERT INTO quota_ledger (msgs_consumed, window_start, plan)
         VALUES (1, '2026-04-29 10:00:00', 'invalid-plan')`,
      ),
    ).toThrow(/CHECK/);
  });
});
