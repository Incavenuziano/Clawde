/**
 * Cálculo de QuotaState a partir de % consumido.
 * Thresholds vêm de config (default 60/80/95).
 */

import type { QuotaState } from "@clawde/domain/quota";

export interface ThresholdConfig {
  readonly aviso: number;
  readonly restrito: number;
  readonly critico: number;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  aviso: 60,
  restrito: 80,
  critico: 95,
};

/**
 * percentConsumed em [0, 100+) (pode passar de 100 se calibração estourar).
 */
export function thresholdToState(
  percentConsumed: number,
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS,
): QuotaState {
  if (percentConsumed >= 100) return "esgotado";
  if (percentConsumed >= thresholds.critico) return "critico";
  if (percentConsumed >= thresholds.restrito) return "restrito";
  if (percentConsumed >= thresholds.aviso) return "aviso";
  return "normal";
}
