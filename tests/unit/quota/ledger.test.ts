import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker } from "@clawde/quota";
import { type TestDb, makeTestDb } from "../../helpers/db.ts";

describe("quota/ledger QuotaTracker", () => {
  let testDb: TestDb;
  let repo: QuotaLedgerRepo;
  let tracker: QuotaTracker;

  beforeEach(() => {
    testDb = makeTestDb();
    repo = new QuotaLedgerRepo(testDb.db);
    tracker = new QuotaTracker(repo, DEFAULT_TRACKER_CONFIG);
  });
  afterEach(() => testDb.cleanup());

  test("recordMessage insere row no ledger", () => {
    tracker.recordMessage(null, new Date("2026-04-29T12:00:00.000Z"));
    const recent = repo.findRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.msgsConsumed).toBe(1);
    expect(recent[0]?.plan).toBe("max5x");
  });

  test("recordMessage em peak hour aplica multiplier", () => {
    // 8 AM PT = peak; multiplier 1.7
    const peakTime = new Date("2026-04-29T15:30:00.000Z");
    tracker.recordMessage(null, peakTime);
    const recent = repo.findRecent();
    expect(recent[0]?.peakMultiplier).toBe(1.7);
  });

  test("recordMessage fora de peak: multiplier 1.0", () => {
    const offPeak = new Date("2026-04-29T20:00:00.000Z"); // 1 PM PT
    tracker.recordMessage(null, offPeak);
    const recent = repo.findRecent();
    expect(recent[0]?.peakMultiplier).toBe(1.0);
  });

  test("currentWindow retorna msgsConsumed agregado", () => {
    const t = new Date("2026-04-29T12:00:00.000Z");
    tracker.recordMessage(null, t);
    tracker.recordMessage(null, t);
    tracker.recordMessage(null, t);

    const window = tracker.currentWindow(t);
    expect(window.msgsConsumed).toBe(3);
    expect(window.plan).toBe("max5x");
  });

  test("currentWindow estado=normal quando <60% capacity", () => {
    const t = new Date("2026-04-29T12:00:00.000Z");
    // capacity max5x = 250, 50 msgs = 20%
    for (let i = 0; i < 50; i++) tracker.recordMessage(null, t);

    expect(tracker.currentWindow(t).state).toBe("normal");
  });

  test("currentWindow estado=aviso em ~70%", () => {
    const t = new Date("2026-04-29T12:00:00.000Z");
    // 175 / 250 = 70%
    for (let i = 0; i < 175; i++) tracker.recordMessage(null, t);

    expect(tracker.currentWindow(t).state).toBe("aviso");
  });

  test("currentWindow estado=esgotado em >=100%", () => {
    const t = new Date("2026-04-29T12:00:00.000Z");
    for (let i = 0; i < 250; i++) tracker.recordMessage(null, t);

    expect(tracker.currentWindow(t).state).toBe("esgotado");
  });

  test("plan=pro tem capacity menor (50)", () => {
    const customTracker = new QuotaTracker(repo, {
      ...DEFAULT_TRACKER_CONFIG,
      plan: "pro",
    });
    const t = new Date("2026-04-29T12:00:00.000Z");
    for (let i = 0; i < 30; i++) customTracker.recordMessage(null, t);
    // 30/50 = 60% → aviso
    expect(customTracker.currentWindow(t).state).toBe("aviso");
  });

  test("currentWindow.resetsAt = now + 5h", () => {
    const t = new Date("2026-04-29T12:00:00.000Z");
    const window = tracker.currentWindow(t);
    expect(window.resetsAt).toBe("2026-04-29 17:00:00");
  });

  test("markCurrentWindowExhausted força estado esgotado", () => {
    const t = new Date("2026-04-29T12:00:00.000Z");
    expect(tracker.currentWindow(t).state).toBe("normal");
    tracker.markCurrentWindowExhausted(t);
    expect(tracker.currentWindow(t).state).toBe("esgotado");
  });
});
