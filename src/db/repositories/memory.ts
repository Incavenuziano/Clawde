/**
 * Repository: memory_observations + busca FTS5 trigram.
 * Embeddings/cosine virão em F5 (ADR 0010); aqui só FTS5.
 */

import type {
  MemoryObservation,
  MemorySearchResult,
  NewMemoryObservation,
  ObservationKind,
} from "@clawde/domain/memory";
import type { ClawdeDatabase } from "../client.ts";

interface RawObservationRow {
  id: number;
  session_id: string | null;
  source_jsonl: string | null;
  kind: ObservationKind;
  content: string;
  importance: number;
  consolidated_into: number | null;
  created_at: string;
}

function rowToObservation(r: RawObservationRow): MemoryObservation {
  return {
    id: r.id,
    sessionId: r.session_id,
    sourceJsonl: r.source_jsonl,
    kind: r.kind,
    content: r.content,
    importance: r.importance,
    consolidatedInto: r.consolidated_into,
    createdAt: r.created_at,
  };
}

export class MemoryRepo {
  constructor(private readonly db: ClawdeDatabase) {}

  insertObservation(input: NewMemoryObservation): MemoryObservation {
    const row = this.db
      .query<
        RawObservationRow,
        [string | null, string | null, ObservationKind, string, number, number | null]
      >(
        `INSERT INTO memory_observations
           (session_id, source_jsonl, kind, content, importance, consolidated_into)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.sessionId,
        input.sourceJsonl,
        input.kind,
        input.content,
        input.importance,
        input.consolidatedInto,
      );
    if (row === null) {
      throw new Error("INSERT...RETURNING returned null");
    }
    return rowToObservation(row);
  }

  findById(id: number): MemoryObservation | null {
    const row = this.db
      .query<RawObservationRow, [number]>("SELECT * FROM memory_observations WHERE id = ?")
      .get(id);
    return row === null ? null : rowToObservation(row);
  }

  /**
   * Busca FTS5 trigram em memory_fts. Retorna observations com score (rank).
   * `query` é repassada literal (FTS5 sintaxe — escape se vier de input externo).
   */
  searchFTS(query: string, limit = 10): ReadonlyArray<MemorySearchResult> {
    interface JoinedRow extends RawObservationRow {
      score: number;
    }
    const rows = this.db
      .query<JoinedRow, [string, number]>(
        `SELECT mo.*, fts.rank AS score
         FROM memory_observations mo
         JOIN (
           SELECT rowid, rank FROM memory_fts WHERE memory_fts MATCH ? LIMIT ?
         ) fts ON fts.rowid = mo.id
         ORDER BY fts.rank`,
      )
      .all(query, limit);
    return rows.map((r) => {
      const { score, ...obsRow } = r;
      return {
        observation: rowToObservation(obsRow),
        score,
        matchType: "fts" as const,
      };
    });
  }

  /**
   * Lista observations por kind (útil para listar lessons).
   */
  listByKind(kind: ObservationKind, limit = 100): ReadonlyArray<MemoryObservation> {
    const rows = this.db
      .query<RawObservationRow, [ObservationKind, number]>(
        "SELECT * FROM memory_observations WHERE kind = ? ORDER BY importance DESC, created_at DESC LIMIT ?",
      )
      .all(kind, limit);
    return rows.map(rowToObservation);
  }
}
