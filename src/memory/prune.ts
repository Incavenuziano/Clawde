/**
 * F5.T54 — Pruning job.
 *
 * Remove observations com importance < cutoff E created_at < now - retentionDays,
 * preservando lessons (kind='lesson' nunca apagado).
 *
 * BEST_PRACTICES §6.9: cleanup mensal. Idempotente (re-rodar sem efeito após 1ª).
 */

import type { MemoryRepo } from "@clawde/db/repositories/memory";

export interface PruneOptions {
  readonly importanceCutoff: number;
  readonly retentionDays: number;
  readonly dryRun?: boolean;
  /** Override `now` para testes. */
  readonly now?: Date;
}

export interface PruneResult {
  readonly deleted: number;
  readonly cutoffDate: string;
  readonly importanceCutoff: number;
  readonly dryRun: boolean;
}

export const DEFAULT_PRUNE_OPTIONS: Pick<PruneOptions, "importanceCutoff" | "retentionDays"> = {
  importanceCutoff: 0.2,
  retentionDays: 90,
};

/**
 * Executa pruning. Em dryRun=true, conta o que seria deletado mas não deleta.
 */
export function prune(repo: MemoryRepo, options: PruneOptions): PruneResult {
  const now = options.now ?? new Date();
  const cutoffMs = now.getTime() - options.retentionDays * 86_400_000;
  const cutoffDate = new Date(cutoffMs).toISOString().replace("T", " ").replace(/\..+$/, "");

  if (options.dryRun === true) {
    const deleted = repo.countPrunable(options.importanceCutoff, cutoffDate);
    return {
      deleted,
      cutoffDate,
      importanceCutoff: options.importanceCutoff,
      dryRun: true,
    };
  }

  const deleted = repo.pruneLowImportance(options.importanceCutoff, cutoffDate);
  return {
    deleted,
    cutoffDate,
    importanceCutoff: options.importanceCutoff,
    dryRun: false,
  };
}
