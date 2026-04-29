/**
 * Quota = controle de mensagens consumidas em sliding window.
 * Modelo definido em ARCHITECTURE §6.6; policy implementação em F2.T25.
 */

import type { Priority } from "./task.ts";

export const PLAN_VALUES = ["pro", "max5x", "max20x"] as const;
export type Plan = (typeof PLAN_VALUES)[number];

export const QUOTA_STATE_VALUES = ["normal", "aviso", "restrito", "critico", "esgotado"] as const;
export type QuotaState = (typeof QUOTA_STATE_VALUES)[number];

export interface QuotaLedgerEntry {
  readonly id: number;
  readonly ts: string;
  readonly msgsConsumed: number;
  readonly windowStart: string;
  readonly plan: Plan;
  readonly peakMultiplier: number;
  readonly taskRunId: number | null;
}

export type NewQuotaLedgerEntry = Omit<QuotaLedgerEntry, "id" | "ts">;

export interface QuotaWindow {
  readonly windowStart: string;
  readonly plan: Plan;
  readonly msgsConsumed: number;
  readonly state: QuotaState;
  readonly resetsAt: string;
}

/**
 * Resultado de QuotaPolicy.canAccept.
 */
export interface QuotaDecision {
  readonly accept: boolean;
  readonly deferUntil: string | null;
  readonly reason: string;
}

/**
 * Contrato do policy. Implementação em src/quota/policy.ts (F2.T25).
 */
export interface QuotaPolicy {
  canAccept(window: QuotaWindow, priority: Priority): QuotaDecision;
}
