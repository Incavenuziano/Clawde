import { describe, expect, test } from "bun:test";
import type { QuotaState, QuotaWindow } from "@clawde/domain/quota";
import {
  DEFAULT_THRESHOLDS,
  checkPeakHours,
  makeQuotaPolicy,
  thresholdToState,
} from "@clawde/quota";

describe("quota/thresholds thresholdToState", () => {
  test.each([
    [0, "normal"],
    [40, "normal"],
    [59.9, "normal"],
    [60, "aviso"],
    [79.9, "aviso"],
    [80, "restrito"],
    [94.9, "restrito"],
    [95, "critico"],
    [99.9, "critico"],
    [100, "esgotado"],
    [120, "esgotado"],
  ])("%i%% → %s", (pct, expected) => {
    expect(thresholdToState(pct, DEFAULT_THRESHOLDS)).toBe(expected as QuotaState);
  });

  test("custom thresholds", () => {
    const custom = { aviso: 50, restrito: 70, critico: 90 };
    expect(thresholdToState(50, custom)).toBe("aviso");
    expect(thresholdToState(70, custom)).toBe("restrito");
    expect(thresholdToState(90, custom)).toBe("critico");
  });
});

describe("quota/policy canAccept", () => {
  const policy = makeQuotaPolicy();

  function window(state: QuotaState): QuotaWindow {
    return {
      windowStart: "2026-04-29 10:00:00",
      plan: "max5x",
      msgsConsumed: 100,
      state,
      resetsAt: "2026-04-29 15:00:00",
    };
  }

  test("normal aceita todas as priorities", () => {
    for (const p of ["LOW", "NORMAL", "HIGH", "URGENT"] as const) {
      expect(policy.canAccept(window("normal"), p).accept).toBe(true);
    }
  });

  test("aviso: LOW adia; NORMAL+ aceita", () => {
    expect(policy.canAccept(window("aviso"), "LOW").accept).toBe(false);
    expect(policy.canAccept(window("aviso"), "NORMAL").accept).toBe(true);
    expect(policy.canAccept(window("aviso"), "HIGH").accept).toBe(true);
    expect(policy.canAccept(window("aviso"), "URGENT").accept).toBe(true);
  });

  test("restrito: HIGH+ aceita; LOW/NORMAL adiam", () => {
    expect(policy.canAccept(window("restrito"), "LOW").accept).toBe(false);
    expect(policy.canAccept(window("restrito"), "NORMAL").accept).toBe(false);
    expect(policy.canAccept(window("restrito"), "HIGH").accept).toBe(true);
    expect(policy.canAccept(window("restrito"), "URGENT").accept).toBe(true);
  });

  test("critico: URGENT only", () => {
    expect(policy.canAccept(window("critico"), "LOW").accept).toBe(false);
    expect(policy.canAccept(window("critico"), "NORMAL").accept).toBe(false);
    expect(policy.canAccept(window("critico"), "HIGH").accept).toBe(false);
    expect(policy.canAccept(window("critico"), "URGENT").accept).toBe(true);
  });

  test("esgotado: bloqueia tudo (incluindo URGENT)", () => {
    expect(policy.canAccept(window("esgotado"), "URGENT").accept).toBe(false);
    expect(policy.canAccept(window("esgotado"), "LOW").accept).toBe(false);
  });

  test("decision deferida carrega resetsAt como deferUntil", () => {
    const decision = policy.canAccept(window("restrito"), "LOW");
    expect(decision.deferUntil).toBe("2026-04-29 15:00:00");
    expect(decision.reason).toContain("priority=LOW");
  });

  test("URGENT bypass funciona em critico", () => {
    const decision = policy.canAccept(window("critico"), "URGENT");
    expect(decision.accept).toBe(true);
    expect(decision.reason).toContain("URGENT bypass");
  });

  test("matriz completa 5 estados x 4 prioridades", () => {
    const cases: Array<[QuotaState, "LOW" | "NORMAL" | "HIGH" | "URGENT", boolean]> = [
      ["normal", "LOW", true],
      ["normal", "NORMAL", true],
      ["normal", "HIGH", true],
      ["normal", "URGENT", true],
      ["aviso", "LOW", false],
      ["aviso", "NORMAL", true],
      ["aviso", "HIGH", true],
      ["aviso", "URGENT", true],
      ["restrito", "LOW", false],
      ["restrito", "NORMAL", false],
      ["restrito", "HIGH", true],
      ["restrito", "URGENT", true],
      ["critico", "LOW", false],
      ["critico", "NORMAL", false],
      ["critico", "HIGH", false],
      ["critico", "URGENT", true],
      ["esgotado", "LOW", false],
      ["esgotado", "NORMAL", false],
      ["esgotado", "HIGH", false],
      ["esgotado", "URGENT", false],
    ];

    for (const [state, priority, accepted] of cases) {
      const decision = policy.canAccept(window(state), priority);
      expect(decision.accept).toBe(accepted);
      if (accepted) {
        expect(decision.deferUntil).toBeNull();
      } else {
        expect(decision.deferUntil).toBe(window(state).resetsAt);
      }
    }
  });
});

describe("quota/peak-hours checkPeakHours", () => {
  test("isPeak=true em hora dentro do range PT", () => {
    // 8 AM PT = 16 UTC (em horário padrão), 15 UTC (em DST). Use range largo.
    const at8amPT = new Date("2026-04-29T15:30:00.000Z");
    const result = checkPeakHours(at8amPT);
    // PDT é UTC-7 em abril; 8:30 AM local = 15:30 UTC ✓
    expect(result.isPeak).toBe(true);
    expect(result.multiplier).toBe(1.7);
  });

  test("isPeak=false em hora fora do range", () => {
    // 18 UTC = 11 AM PDT — borda exclusiva (endLocal = 11:00, < não <=)
    const at11amPT = new Date("2026-04-29T18:00:00.000Z");
    const result = checkPeakHours(at11amPT);
    expect(result.isPeak).toBe(false);
    expect(result.multiplier).toBe(1.0);
  });

  test("config custom respeitado", () => {
    const result = checkPeakHours(new Date("2026-04-29T12:00:00.000Z"), {
      timezone: "UTC",
      startLocal: "10:00",
      endLocal: "14:00",
      multiplier: 2.0,
    });
    expect(result.isPeak).toBe(true);
    expect(result.multiplier).toBe(2.0);
  });
});
