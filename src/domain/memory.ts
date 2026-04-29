/**
 * Memory = observations indexáveis (FTS5 + opcional embeddings).
 * Schema em ARCHITECTURE §11.2; learning layer em ADR 0009; embeddings em ADR 0010.
 */

export const OBSERVATION_KIND_VALUES = ["observation", "summary", "decision", "lesson"] as const;
export type ObservationKind = (typeof OBSERVATION_KIND_VALUES)[number];

export interface MemoryObservation {
  readonly id: number;
  readonly sessionId: string | null;
  readonly sourceJsonl: string | null;
  readonly kind: ObservationKind;
  readonly content: string;
  readonly importance: number;
  readonly consolidatedInto: number | null;
  readonly createdAt: string;
}

export type NewMemoryObservation = Omit<MemoryObservation, "id" | "createdAt">;

export const MEMORY_MATCH_TYPES = ["fts", "embedding", "hybrid"] as const;
export type MemoryMatchType = (typeof MEMORY_MATCH_TYPES)[number];

export interface MemorySearchResult {
  readonly observation: MemoryObservation;
  readonly score: number;
  readonly matchType: MemoryMatchType;
}
