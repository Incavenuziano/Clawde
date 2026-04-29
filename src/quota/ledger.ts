/**
 * QuotaTracker: decrementa quota_ledger conforme mensagens são processadas
 * pelo worker. Calcula janela ativa, peak multiplier, estado.
 */

import type { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import type { Plan, QuotaState, QuotaWindow } from "@clawde/domain/quota";
import { DEFAULT_PEAK_CONFIG, type PeakHoursConfig, checkPeakHours } from "./peak-hours.ts";
import { DEFAULT_THRESHOLDS, type ThresholdConfig, thresholdToState } from "./thresholds.ts";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

export interface QuotaTrackerConfig {
  readonly plan: Plan;
  readonly capacityPerWindow: Record<Plan, number>;
  readonly thresholds: ThresholdConfig;
  readonly peakHours: PeakHoursConfig;
}

export const DEFAULT_TRACKER_CONFIG: QuotaTrackerConfig = {
  plan: "max5x",
  capacityPerWindow: { pro: 50, max5x: 250, max20x: 1000 },
  thresholds: DEFAULT_THRESHOLDS,
  peakHours: DEFAULT_PEAK_CONFIG,
};

export class QuotaTracker {
  constructor(
    private readonly repo: QuotaLedgerRepo,
    private readonly config: QuotaTrackerConfig = DEFAULT_TRACKER_CONFIG,
  ) {}

  /**
   * Registra 1 mensagem consumida no ledger. Aplica peak multiplier ao decremento
   * (mensagens em peak hours pesam mais por consumirem quota mais rápido).
   */
  recordMessage(taskRunId: number | null = null, now: Date = new Date()): void {
    const peak = checkPeakHours(now, this.config.peakHours);
    this.repo.insert({
      msgsConsumed: 1,
      windowStart: this.repo.currentWindowStart(now),
      plan: this.config.plan,
      peakMultiplier: peak.multiplier,
      taskRunId,
    });
  }

  /**
   * Estado atual da janela ativa.
   */
  currentWindow(now: Date = new Date()): QuotaWindow {
    const consumed = this.repo.totalInWindow(now);
    const capacity = this.config.capacityPerWindow[this.config.plan];
    const percent = capacity > 0 ? (consumed / capacity) * 100 : 0;
    const state: QuotaState = thresholdToState(percent, this.config.thresholds);
    return {
      windowStart: this.repo.currentWindowStart(now),
      plan: this.config.plan,
      msgsConsumed: consumed,
      state,
      resetsAt: this.computeResetsAt(now),
    };
  }

  private computeResetsAt(now: Date): string {
    const reset = new Date(now.getTime() + FIVE_HOURS_MS);
    return reset.toISOString().replace("T", " ").replace(/\..+$/, "");
  }
}
