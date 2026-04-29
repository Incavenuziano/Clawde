/**
 * Repository: task_runs (cada tentativa com lease/heartbeat).
 * Reusa state.ts para validar transições.
 */

import type { TaskRun, TaskRunStatus } from "@clawde/domain/task";
import { validateTaskRunTransition } from "@clawde/state";
import type { ClawdeDatabase } from "../client.ts";

interface RawTaskRunRow {
  id: number;
  task_id: number;
  attempt_n: number;
  worker_id: string;
  status: TaskRunStatus;
  not_before: string | null;
  lease_until: string | null;
  started_at: string | null;
  finished_at: string | null;
  result: string | null;
  error: string | null;
  msgs_consumed: number;
}

function rowToTaskRun(r: RawTaskRunRow): TaskRun {
  return {
    id: r.id,
    taskId: r.task_id,
    attemptN: r.attempt_n,
    workerId: r.worker_id,
    status: r.status,
    notBefore: r.not_before,
    leaseUntil: r.lease_until,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    result: r.result,
    error: r.error,
    msgsConsumed: r.msgs_consumed,
  };
}

export class TaskRunsRepo {
  constructor(private readonly db: ClawdeDatabase) {}

  /**
   * Insere novo task_run em status=pending. attempt_n auto-incrementa por task_id.
   */
  insert(taskId: number, workerId: string, options?: { notBefore?: string | null }): TaskRun {
    const nextAttempt =
      this.db
        .query<{ n: number }, [number]>(
          "SELECT COALESCE(MAX(attempt_n), 0) + 1 AS n FROM task_runs WHERE task_id = ?",
        )
        .get(taskId)?.n ?? 1;

    const row = this.db
      .query<RawTaskRunRow, [number, number, string, string | null]>(
        `INSERT INTO task_runs (task_id, attempt_n, worker_id, status, not_before)
         VALUES (?, ?, ?, 'pending', ?) RETURNING *`,
      )
      .get(taskId, nextAttempt, workerId, options?.notBefore ?? null);
    if (row === null) {
      throw new Error("INSERT...RETURNING returned null");
    }
    return rowToTaskRun(row);
  }

  findById(id: number): TaskRun | null {
    const row = this.db
      .query<RawTaskRunRow, [number]>("SELECT * FROM task_runs WHERE id = ?")
      .get(id);
    return row === null ? null : rowToTaskRun(row);
  }

  findLatestByTaskId(taskId: number): TaskRun | null {
    const row = this.db
      .query<RawTaskRunRow, [number]>(
        "SELECT * FROM task_runs WHERE task_id = ? ORDER BY attempt_n DESC LIMIT 1",
      )
      .get(taskId);
    return row === null ? null : rowToTaskRun(row);
  }

  /**
   * Adquire lease atômico. Transiciona pending → running e seta lease_until/started_at.
   * Retorna a TaskRun atualizada ou null se concorrência venceu.
   */
  acquireLease(id: number, leaseSeconds: number): TaskRun | null {
    // datetime('now', '+N seconds') gera timestamp no mesmo formato que datetime('now'),
    // garantindo comparação string consistente em findExpiredLeases.
    const result = this.db.run(
      `UPDATE task_runs
         SET status = 'running',
             lease_until = datetime('now', ?),
             started_at = COALESCE(started_at, datetime('now'))
       WHERE id = ?
         AND status = 'pending'`,
      [`+${leaseSeconds} seconds`, id],
    );
    if (result.changes === 0) {
      return null;
    }
    return this.findById(id);
  }

  /**
   * Estende o lease. Só funciona se ainda em running.
   */
  heartbeat(id: number, leaseSeconds: number): boolean {
    const result = this.db.run(
      "UPDATE task_runs SET lease_until = datetime('now', ?) WHERE id = ? AND status = 'running'",
      [`+${leaseSeconds} seconds`, id],
    );
    return result.changes > 0;
  }

  setNotBefore(id: number, isoTimestamp: string | null): TaskRun {
    this.db.run("UPDATE task_runs SET not_before = ? WHERE id = ?", [isoTimestamp, id]);
    const after = this.findById(id);
    if (after === null) {
      throw new Error(`task_run ${id} disappeared after setNotBefore`);
    }
    return after;
  }

  /**
   * Transição de status com validação. Para succeeded/failed seta finished_at,
   * limpa lease_until e (opcional) result/error/msgs_consumed.
   */
  transitionStatus(
    id: number,
    to: TaskRunStatus,
    extras: { result?: string | null; error?: string | null; msgsConsumed?: number } = {},
  ): TaskRun {
    const current = this.findById(id);
    if (current === null) {
      throw new Error(`task_run ${id} not found`);
    }
    validateTaskRunTransition(current.status, to);

    const isTerminal = to === "succeeded" || to === "failed" || to === "abandoned";
    this.db.run(
      `UPDATE task_runs
         SET status = ?,
             lease_until = CASE WHEN ? THEN NULL ELSE lease_until END,
             finished_at = CASE WHEN ? THEN datetime('now') ELSE finished_at END,
             result = COALESCE(?, result),
             error = COALESCE(?, error),
             msgs_consumed = CASE WHEN ? IS NULL THEN msgs_consumed ELSE ? END
       WHERE id = ?`,
      [
        to,
        isTerminal ? 1 : 0,
        isTerminal ? 1 : 0,
        extras.result ?? null,
        extras.error ?? null,
        extras.msgsConsumed ?? null,
        extras.msgsConsumed ?? 0,
        id,
      ],
    );
    const after = this.findById(id);
    if (after === null) {
      throw new Error(`task_run ${id} disappeared after UPDATE`);
    }
    return after;
  }

  /**
   * Lista task_runs com lease expirado (running com lease_until < now).
   * Usado pelo reconcile no startup do worker.
   */
  findExpiredLeases(): ReadonlyArray<TaskRun> {
    const rows = this.db
      .query<RawTaskRunRow, []>(
        `SELECT * FROM task_runs
         WHERE status = 'running'
           AND lease_until IS NOT NULL
           AND lease_until < datetime('now')`,
      )
      .all();
    return rows.map(rowToTaskRun);
  }
}
