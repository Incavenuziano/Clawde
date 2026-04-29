/**
 * F5.T52 — Importance scoring updater.
 *
 * Heurística simples (sem LLM) de score baseada em sinais persistidos:
 *   - Recência (created_at): observations recentes começam com importance maior
 *   - Frequência de FTS5 match: hits recentes = importância sobe
 *   - Consolidação: observations referenciadas por lessons sobem
 *   - Decadência: tempo sem citação reduz importance gradualmente
 *
 * NÃO usa LLM-as-judge — fica como upgrade futuro (F5+ refinement).
 *
 * Score em [0.0, 1.0]; clamp explícito.
 */

import type { ClawdeDatabase } from "@clawde/db/client";
import type { MemoryRepo } from "@clawde/db/repositories/memory";

export interface ImportanceScoringConfig {
  /** Score base para nova observation. */
  readonly baseScore: number;
  /** Decay multiplicador por dia sem citação. 0.99 = -1% por dia. */
  readonly decayPerDay: number;
  /** Boost por ser referenciada em consolidated_into de outra observation. */
  readonly consolidationBoost: number;
  /** Score floor: lessons nunca caem abaixo disso. */
  readonly lessonFloor: number;
  /** Score floor para observations regulares (acima delas, prune respeita). */
  readonly observationFloor: number;
}

export const DEFAULT_IMPORTANCE_CONFIG: ImportanceScoringConfig = {
  baseScore: 0.5,
  decayPerDay: 0.99,
  consolidationBoost: 0.15,
  lessonFloor: 0.7,
  observationFloor: 0.0,
};

interface RecalcRow {
  id: number;
  kind: string;
  importance: number;
  created_at: string;
  ref_count: number;
}

/**
 * Recalcula importance de todas as observations baseado em:
 *   - Idade (decay exponencial por dia)
 *   - ref_count: quantas outras observations referenciam esta via consolidated_into
 *   - kind: lessons têm floor mínimo configurável
 *
 * Retorna estatísticas { updated, skipped }.
 */
export function recalcImportance(
  db: ClawdeDatabase,
  repo: MemoryRepo,
  now: Date = new Date(),
  config: ImportanceScoringConfig = DEFAULT_IMPORTANCE_CONFIG,
): { updated: number; skipped: number } {
  const rows = db
    .query<RecalcRow, []>(
      `SELECT
         mo.id,
         mo.kind,
         mo.importance,
         mo.created_at,
         (SELECT COUNT(*) FROM memory_observations c WHERE c.consolidated_into = mo.id) AS ref_count
       FROM memory_observations mo`,
    )
    .all();

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const ageDays = ageInDays(row.created_at, now);
    const decay = config.decayPerDay ** ageDays;
    const consolidationBonus = row.ref_count * config.consolidationBoost;

    let newScore = config.baseScore * decay + consolidationBonus;

    // Aplicar floors por kind.
    if (row.kind === "lesson") {
      newScore = Math.max(newScore, config.lessonFloor);
    } else {
      newScore = Math.max(newScore, config.observationFloor);
    }

    newScore = clamp(newScore, 0, 1);

    // Só update se diferença significativa (>0.01).
    if (Math.abs(newScore - row.importance) > 0.01) {
      repo.updateImportance(row.id, newScore);
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return { updated, skipped };
}

/**
 * Helper exposto pra testes: calcula score para 1 observation isoladamente.
 */
export function scoreObservation(input: {
  kind: string;
  createdAt: string;
  refCount: number;
  now?: Date;
  config?: ImportanceScoringConfig;
}): number {
  const config = input.config ?? DEFAULT_IMPORTANCE_CONFIG;
  const ageDays = ageInDays(input.createdAt, input.now ?? new Date());
  const decay = config.decayPerDay ** ageDays;
  let score = config.baseScore * decay + input.refCount * config.consolidationBoost;
  if (input.kind === "lesson") {
    score = Math.max(score, config.lessonFloor);
  } else {
    score = Math.max(score, config.observationFloor);
  }
  return clamp(score, 0, 1);
}

function ageInDays(createdAt: string, now: Date): number {
  // Aceita "2026-04-29 12:00:00" (SQLite default) ou ISO-8601.
  const parsed = new Date(createdAt.includes("T") ? createdAt : `${createdAt}Z`.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, (now.getTime() - parsed.getTime()) / 86_400_000);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
