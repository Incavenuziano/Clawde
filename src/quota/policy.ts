/**
 * QuotaPolicy implementa matriz de aceitação de tasks por priority + estado da janela.
 * Baseado em ARCHITECTURE §6.6.
 *
 * Matriz:
 *   normal:   aceita tudo
 *   aviso:    LOW adia; NORMAL+ aceita
 *   restrito: HIGH+ aceita; LOW/NORMAL adiam
 *   critico:  URGENT only; demais adiam
 *   esgotado: bloqueia tudo (deferUntil = resetsAt)
 *
 * Reserve URGENT: percentual da janela reservado pra URGENT mesmo em estados
 * `restrito`/`critico` (default 15%, configurável).
 */

import { sendAlertBestEffort } from "@clawde/alerts";
import type {
  Plan,
  QuotaDecision,
  QuotaPolicy,
  QuotaState,
  QuotaWindow,
} from "@clawde/domain/quota";
import type { Priority } from "@clawde/domain/task";

export const PRIORITY_RANK: Record<Priority, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3,
};

const STATE_MIN_PRIORITY: Record<QuotaState, number> = {
  normal: PRIORITY_RANK.LOW,
  aviso: PRIORITY_RANK.NORMAL,
  restrito: PRIORITY_RANK.HIGH,
  critico: PRIORITY_RANK.URGENT,
  esgotado: Number.POSITIVE_INFINITY,
};

export interface ThresholdsConfig {
  readonly aviso: number;
  readonly restrito: number;
  readonly critico: number;
}

export interface PolicyConfig {
  readonly thresholds: ThresholdsConfig;
  readonly reserveUrgentPct: number;
  /** Estimativa de capacidade total da janela por plan (aprox; calibrável). */
  readonly windowCapacity: Record<Plan, number>;
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  thresholds: { aviso: 60, restrito: 80, critico: 95 },
  reserveUrgentPct: 15,
  // Estimativas; serão calibradas em produção via observação.
  // Não há documentação oficial, números refletem ordens de grandeza.
  windowCapacity: {
    pro: 50,
    max5x: 250,
    max20x: 1000,
  },
};

export function makeQuotaPolicy(_config: PolicyConfig = DEFAULT_POLICY_CONFIG): QuotaPolicy {
  // Config aceito para extensibilidade futura (custom thresholds/reserve).
  return {
    canAccept(window: QuotaWindow, priority: Priority): QuotaDecision {
      if (window.state === "critico") {
        void sendAlertBestEffort({
          severity: "high",
          trigger: "quota_critical",
          cooldownKey: `quota_critical_${window.plan}`,
          cooldownMs: 60 * 60 * 1000,
          payload: {
            plan: window.plan,
            state: window.state,
            msgs_consumed: window.msgsConsumed,
            window_start: window.windowStart,
            resets_at: window.resetsAt,
          },
        });
      }
      const requiredRank = STATE_MIN_PRIORITY[window.state];
      const priorityRank = PRIORITY_RANK[priority];

      // URGENT sempre tem janela reservada (exceto se totalmente esgotado).
      if (priority === "URGENT" && window.state !== "esgotado") {
        return {
          accept: true,
          deferUntil: null,
          reason: `URGENT bypass for state=${window.state}`,
        };
      }

      if (priorityRank >= requiredRank && window.state !== "esgotado") {
        return {
          accept: true,
          deferUntil: null,
          reason: `priority=${priority} accepted in state=${window.state}`,
        };
      }

      return {
        accept: false,
        deferUntil: window.resetsAt,
        reason:
          window.state === "esgotado"
            ? "quota exhausted; defer until window reset"
            : `priority=${priority} too low for state=${window.state}; defer until reset`,
      };
    },
  };
}
