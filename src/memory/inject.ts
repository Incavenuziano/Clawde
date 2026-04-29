/**
 * F5.T53 — Memory-aware prompting.
 *
 * Antes de invocar Claude, worker chama buildMemoryContext(taskContext) que:
 *   1. Faz searchHybrid pra recuperar top-K observations relevantes
 *   2. Filtra por importance >= threshold
 *   3. Renderiza como `<prior_context source="clawde-memory">…</prior_context>`
 *      pra ser injetado via --append-system-prompt
 *
 * Cap configurável de tokens (heurística: ~4 chars por token) — trunca por
 * importance descendente.
 */

import type { MemoryRepo } from "@clawde/db/repositories/memory";
import type { MemoryObservation } from "@clawde/domain/memory";
import { type EmbeddingProvider, getEmbeddingProvider } from "./embeddings.ts";
import { searchHybrid } from "./search.ts";

export interface MemoryAwareConfig {
  readonly enabled: boolean;
  readonly topK: number;
  readonly minImportance: number;
  readonly maxInjectChars: number;
  readonly source: string;
}

export const DEFAULT_MEMORY_AWARE_CONFIG: MemoryAwareConfig = {
  enabled: true,
  topK: 5,
  minImportance: 0.3,
  maxInjectChars: 12_000, // ~3K tokens
  source: "clawde-memory",
};

export interface MemoryContextResult {
  readonly injected: boolean;
  readonly snippet: string;
  readonly observations: ReadonlyArray<MemoryObservation>;
  readonly truncated: number;
}

/**
 * Constrói snippet pra ser injetado no system prompt.
 * Quando enabled=false, retorna {injected:false, snippet:""}.
 * Sem matches → {injected:false}.
 */
export async function buildMemoryContext(
  repo: MemoryRepo,
  query: string,
  config: MemoryAwareConfig = DEFAULT_MEMORY_AWARE_CONFIG,
  embeddingProvider?: EmbeddingProvider,
): Promise<MemoryContextResult> {
  if (!config.enabled) {
    return { injected: false, snippet: "", observations: [], truncated: 0 };
  }

  const provider = embeddingProvider ?? getEmbeddingProvider();
  const results = await searchHybrid(repo, { query, limit: config.topK }, provider);

  // Filtra por importance.
  const filtered = results.filter(
    (r) => r.observation.importance >= config.minImportance,
  );

  if (filtered.length === 0) {
    return { injected: false, snippet: "", observations: [], truncated: 0 };
  }

  // Sort por importance desc para truncar do menos importante primeiro.
  const sorted = [...filtered].sort(
    (a, b) => b.observation.importance - a.observation.importance,
  );

  const lines: string[] = [];
  let totalChars = 0;
  let truncated = 0;
  const used: MemoryObservation[] = [];

  for (const result of sorted) {
    const obs = result.observation;
    const line = `[${obs.kind}|importance=${obs.importance.toFixed(2)}] ${obs.content}`;
    if (totalChars + line.length + 1 > config.maxInjectChars) {
      truncated = sorted.length - used.length;
      break;
    }
    lines.push(line);
    totalChars += line.length + 1;
    used.push(obs);
  }

  if (used.length === 0) {
    return { injected: false, snippet: "", observations: [], truncated: 0 };
  }

  const snippet = `<prior_context source="${config.source}">
${lines.join("\n")}
</prior_context>`;

  return {
    injected: true,
    snippet,
    observations: used,
    truncated,
  };
}
