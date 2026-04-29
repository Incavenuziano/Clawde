/**
 * F5.T49 — Hybrid search FTS5 + embeddings.
 *
 * Quando embeddings habilitados, faz search FTS5 + cosine similarity (carregando
 * embedding_blob do BLOB persistido) e funde via Reciprocal Rank Fusion (RRF).
 *
 * Boost por importance: score final = rrf * (1 + importance_boost * importance).
 *
 * Sem sqlite-vec por enquanto — cosine search lê BLOB direto do SQLite (custo
 * O(N) por query). Funcional pra <10k observations; F5+ pode adicionar
 * sqlite-vec.
 */

import type { MemoryRepo } from "@clawde/db/repositories/memory";
import type { MemoryObservation, MemorySearchResult } from "@clawde/domain/memory";
import { type EmbeddingProvider, EMBEDDING_DIM, cosineSim } from "./embeddings.ts";

export interface HybridSearchOptions {
  readonly query: string;
  readonly limit: number;
  /** Boost multiplicador por importance: score *= (1 + boost * importance). */
  readonly importanceBoost?: number;
  /** Constante RRF (típico = 60). */
  readonly rrfK?: number;
}

const DEFAULT_RRF_K = 60;
const DEFAULT_IMPORTANCE_BOOST = 0.5;

/**
 * Fusão Reciprocal Rank Fusion: score = sum(1/(k+rank_i)).
 */
function rrfScore(ranks: ReadonlyArray<number>, k: number): number {
  let s = 0;
  for (const r of ranks) s += 1 / (k + r);
  return s;
}

/**
 * Search híbrida. Se embedding_provider for NoopEmbeddingProvider (zero vec)
 * ou observations não tiverem embeddings persistidos, cai pra FTS5 only.
 */
export async function searchHybrid(
  repo: MemoryRepo,
  options: HybridSearchOptions,
  embeddingProvider?: EmbeddingProvider,
): Promise<ReadonlyArray<MemorySearchResult>> {
  const k = options.rrfK ?? DEFAULT_RRF_K;
  const boost = options.importanceBoost ?? DEFAULT_IMPORTANCE_BOOST;

  const ftsResults = repo.searchFTS(options.query, options.limit * 3);
  const ftsRanks = new Map<number, number>();
  ftsResults.forEach((r, i) => ftsRanks.set(r.observation.id, i + 1));

  let cosineResults: ReadonlyArray<{ obs: MemoryObservation; score: number }> = [];
  if (embeddingProvider !== undefined && embeddingProvider.modelId !== "noop") {
    cosineResults = await searchByCosine(
      repo,
      options.query,
      embeddingProvider,
      options.limit * 3,
    );
  }
  const cosRanks = new Map<number, number>();
  cosineResults.forEach((r, i) => cosRanks.set(r.obs.id, i + 1));

  // Coleta IDs únicos.
  const allIds = new Set<number>([...ftsRanks.keys(), ...cosRanks.keys()]);

  // Calcula score RRF para cada ID.
  const fused: Array<{ obs: MemoryObservation; score: number; matchType: "fts" | "embedding" | "hybrid" }> = [];
  for (const id of allIds) {
    const fRank = ftsRanks.get(id);
    const cRank = cosRanks.get(id);
    const ranks: number[] = [];
    if (fRank !== undefined) ranks.push(fRank);
    if (cRank !== undefined) ranks.push(cRank);
    const baseScore = rrfScore(ranks, k);

    const obs =
      ftsResults.find((r) => r.observation.id === id)?.observation ??
      cosineResults.find((r) => r.obs.id === id)?.obs;
    if (obs === undefined) continue;

    const finalScore = baseScore * (1 + boost * obs.importance);
    const matchType: "fts" | "embedding" | "hybrid" =
      fRank !== undefined && cRank !== undefined
        ? "hybrid"
        : fRank !== undefined
          ? "fts"
          : "embedding";
    fused.push({ obs, score: finalScore, matchType });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, options.limit).map((f) => ({
    observation: f.obs,
    score: f.score,
    matchType: f.matchType,
  }));
}

/**
 * Cosine search lendo embedding BLOB do SQLite. O(N) — funcional pra <10k.
 */
async function searchByCosine(
  repo: MemoryRepo,
  query: string,
  provider: EmbeddingProvider,
  limit: number,
): Promise<ReadonlyArray<{ obs: MemoryObservation; score: number }>> {
  const queryVec = await provider.embed(query);
  const all = repo.listAllWithEmbeddings();
  const scored: Array<{ obs: MemoryObservation; score: number }> = [];
  for (const { obs, embedding } of all) {
    if (embedding === null) continue;
    const score = cosineSim(queryVec, embedding);
    scored.push({ obs, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export { EMBEDDING_DIM };
