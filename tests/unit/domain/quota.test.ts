import { describe, expect, test } from "bun:test";
import {
  PLAN_VALUES,
  type Plan,
  QUOTA_STATE_VALUES,
  type QuotaDecision,
  type QuotaLedgerEntry,
  type QuotaState,
  type QuotaWindow,
} from "@clawde/domain/quota";

describe("domain/quota constants", () => {
  test("PLAN_VALUES enumerates 3 Anthropic plans", () => {
    expect(PLAN_VALUES).toEqual(["pro", "max5x", "max20x"]);
  });

  test("QUOTA_STATE_VALUES enumerates 5 thresholds (ARCHITECTURE §6.6)", () => {
    expect(QUOTA_STATE_VALUES).toEqual(["normal", "aviso", "restrito", "critico", "esgotado"]);
  });
});

describe("domain/quota types compile", () => {
  test("QuotaLedgerEntry sample", () => {
    const entry: QuotaLedgerEntry = {
      id: 1,
      ts: "2026-04-29T10:00:00.000Z",
      msgsConsumed: 1,
      windowStart: "2026-04-29T10:00:00.000Z",
      plan: "max5x" satisfies Plan,
      peakMultiplier: 1.0,
      taskRunId: 42,
    };
    expect(entry.plan).toBe("max5x");
  });

  test("QuotaWindow sample (state restricto)", () => {
    const window: QuotaWindow = {
      windowStart: "2026-04-29T05:00:00.000Z",
      plan: "max5x",
      msgsConsumed: 180,
      state: "restrito" satisfies QuotaState,
      resetsAt: "2026-04-29T10:00:00.000Z",
    };
    expect(window.state).toBe("restrito");
  });

  test("QuotaDecision shape", () => {
    const ok: QuotaDecision = { accept: true, deferUntil: null, reason: "below threshold" };
    const deferred: QuotaDecision = {
      accept: false,
      deferUntil: "2026-04-29T10:30:00.000Z",
      reason: "critical: only URGENT accepted",
    };
    expect(ok.accept).toBe(true);
    expect(deferred.deferUntil).not.toBeNull();
  });
});
