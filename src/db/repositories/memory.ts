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
   * Helper para o indexer: checa se uma session_id existe em sessions.
   * Necessário porque FK falha em INSERT se sessionId aponta pra row inexistente.
   */
  sessionExists(sessionId: string): boolean {
    const row = this.db
      .query<{ c: number }, [string]>("SELECT COUNT(*) AS c FROM sessions WHERE session_id = ?")
      .get(sessionId);
    return (row?.c ?? 0) > 0;
  }

  /**
   * Busca por sourceJsonl exato (usado pelo indexer pra dedup).
   */
  findBySourceJsonl(sourceJsonl: string): MemoryObservation | null {
    const row = this.db
      .query<RawObservationRow, [string]>(
        "SELECT * FROM memory_observations WHERE source_jsonl = ?",
      )
      .get(sourceJsonl);
    return row === null ? null : rowToObservation(row);
  }

  /**
   * Atualiza embedding de uma observation (Float32Array → BLOB).
   * Migration 002 adiciona a coluna.
   */
  updateEmbedding(id: number, embedding: Float32Array): void {
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db.run("UPDATE memory_observations SET embedding = ? WHERE id = ?", [buf, id]);
  }

  /**
   * Atualiza importance score de uma observation. Usado por F5.T52.
   */
  updateImportance(id: number, importance: number): void {
    const clamped = Math.max(0, Math.min(1, importance));
    this.db.run("UPDATE memory_observations SET importance = ? WHERE id = ?", [clamped, id]);
  }

  /**
   * Marca observation como consolidada em lesson de id targetLessonId.
   * Usado pelo reflector (F5.T51).
   */
  markConsolidated(id: number, targetLessonId: number): void {
    this.db.run("UPDATE memory_observations SET consolidated_into = ? WHERE id = ?", [
      targetLessonId,
      id,
    ]);
  }

  /**
   * Lista TODAS as observations com seus embeddings parseados.
   * Usado pelo cosine search (custo O(N), funcional pra <10k).
   */
  listAllWithEmbeddings(): ReadonlyArray<{
    obs: MemoryObservation;
    embedding: Float32Array | null;
  }> {
    interface RowWithEmbedding extends RawObservationRow {
      embedding: Buffer | null;
    }
    const rows = this.db
      .query<RowWithEmbedding, []>(
        "SELECT id, session_id, source_jsonl, kind, content, importance, consolidated_into, created_at, embedding FROM memory_observations",
      )
      .all();
    return rows.map((r) => ({
      obs: rowToObservation(r),
      embedding:
        r.embedding === null
          ? null
          : new Float32Array(
              r.embedding.buffer,
              r.embedding.byteOffset,
              r.embedding.byteLength / 4,
            ),
    }));
  }

  /**
   * Conta quantas rows seriam deletadas pelo pruning (dryRun helper).
   */
  countPrunable(importanceCutoff: number, cutoffDate: string): number {
    const row = this.db
      .query<{ c: number }, [number, string]>(
        `SELECT COUNT(*) AS c FROM memory_observations
         WHERE kind != 'lesson'
           AND importance < ?
           AND created_at < ?`,
      )
      .get(importanceCutoff, cutoffDate);
    return row?.c ?? 0;
  }

  /**
   * Deleta observations com importance < cutoff E created_at < cutoffDate,
   * preservando lessons. Usado pelo pruning (F5.T54).
   * Retorna número de rows deletadas (não inclui triggers cascateados — usa
   * countPrunable antes do DELETE pra valor preciso).
   */
  pruneLowImportance(importanceCutoff: number, cutoffDate: string): number {
    // changes do bun:sqlite conta também trigger inserts (memory_fts_delete);
    // contamos antes pra valor preciso de rows efetivamente deletadas.
    const willDelete = this.countPrunable(importanceCutoff, cutoffDate);
    this.db.run(
      `DELETE FROM memory_observations
       WHERE kind != 'lesson'
         AND importance < ?
         AND created_at < ?`,
      [importanceCutoff, cutoffDate],
    );
    return willDelete;
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
