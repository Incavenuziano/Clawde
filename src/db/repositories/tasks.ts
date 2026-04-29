/**
 * Repository: tasks (intent imutável).
 * INSERT é o único write permitido — tasks_no_update trigger bloqueia UPDATE.
 */

import type { NewTask, Priority, Task, TaskSource } from "@clawde/domain/task";
import type { ClawdeDatabase } from "../client.ts";

export class DedupConflictError extends Error {
  constructor(public readonly dedupKey: string) {
    super(`task with dedup_key='${dedupKey}' already exists`);
    this.name = "DedupConflictError";
  }
}

interface RawTaskRow {
  id: number;
  priority: Priority;
  prompt: string;
  agent: string;
  session_id: string | null;
  working_dir: string | null;
  depends_on: string;
  source: TaskSource;
  source_metadata: string;
  dedup_key: string | null;
  created_at: string;
}

function rowToTask(row: RawTaskRow): Task {
  return {
    id: row.id,
    priority: row.priority,
    prompt: row.prompt,
    agent: row.agent,
    sessionId: row.session_id,
    workingDir: row.working_dir,
    dependsOn: JSON.parse(row.depends_on) as ReadonlyArray<number>,
    source: row.source,
    sourceMetadata: JSON.parse(row.source_metadata) as Record<string, unknown>,
    dedupKey: row.dedup_key,
    createdAt: row.created_at,
  };
}

export class TasksRepo {
  constructor(private readonly db: ClawdeDatabase) {}

  /**
   * INSERT em tasks. Retorna a Task completa.
   * Lança DedupConflictError se dedup_key já existir.
   */
  insert(input: NewTask): Task {
    try {
      const result = this.db
        .query<
          RawTaskRow,
          [
            Priority,
            string,
            string,
            string | null,
            string | null,
            string,
            TaskSource,
            string,
            string | null,
          ]
        >(
          `INSERT INTO tasks
             (priority, prompt, agent, session_id, working_dir, depends_on,
              source, source_metadata, dedup_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .get(
          input.priority,
          input.prompt,
          input.agent,
          input.sessionId,
          input.workingDir,
          JSON.stringify(input.dependsOn),
          input.source,
          JSON.stringify(input.sourceMetadata),
          input.dedupKey,
        );
      if (result === null) {
        throw new Error("INSERT...RETURNING returned null");
      }
      return rowToTask(result);
    } catch (err) {
      const message = (err as Error).message;
      if (
        message.includes("UNIQUE constraint failed: tasks.dedup_key") &&
        input.dedupKey !== null
      ) {
        throw new DedupConflictError(input.dedupKey);
      }
      throw err;
    }
  }

  findById(id: number): Task | null {
    const row = this.db.query<RawTaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(id);
    return row === null ? null : rowToTask(row);
  }

  findByDedupKey(key: string): Task | null {
    const row = this.db
      .query<RawTaskRow, [string]>("SELECT * FROM tasks WHERE dedup_key = ?")
      .get(key);
    return row === null ? null : rowToTask(row);
  }

  /**
   * Tasks pendentes (sem nenhum task_run em qualquer status terminal succeeded/failed,
   * e que não tenham task_run em running com lease ativo).
   * Para fila simples nesta fase: retorna tasks sem nenhum task_run ainda.
   * Ordenado por priority desc + created_at asc.
   */
  findPending(limit = 100): ReadonlyArray<Task> {
    const rows = this.db
      .query<RawTaskRow, [number]>(
        `SELECT t.* FROM tasks t
         LEFT JOIN task_runs tr ON tr.task_id = t.id
         WHERE tr.id IS NULL
         ORDER BY
           CASE t.priority
             WHEN 'URGENT' THEN 0
             WHEN 'HIGH'   THEN 1
             WHEN 'NORMAL' THEN 2
             WHEN 'LOW'    THEN 3
           END,
           t.created_at
         LIMIT ?`,
      )
      .all(limit);
    return rows.map(rowToTask);
  }
}
