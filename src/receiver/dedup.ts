/**
 * Dedup helper: extrai idempotency key do request (header X-Idempotency-Key
 * OU body.dedupKey), passa pra TasksRepo.findByDedupKey/insert.
 *
 * BLUEPRINT §3.1: 409 Conflict quando dedup_key já existe; retorna o taskId
 * existente + flag `deduped: true`.
 */

import type { TasksRepo } from "@clawde/db/repositories/tasks";
import { DedupConflictError } from "@clawde/db/repositories/tasks";
import type { NewTask, Task } from "@clawde/domain/task";

export interface DedupResult {
  readonly task: Task;
  readonly deduped: boolean;
}

/**
 * Tenta inserir; se DedupConflictError, retorna a task existente com deduped=true.
 */
export function insertWithDedup(repo: TasksRepo, input: NewTask): DedupResult {
  if (input.dedupKey !== null) {
    const existing = repo.findByDedupKey(input.dedupKey);
    if (existing !== null) {
      return { task: existing, deduped: true };
    }
  }
  try {
    const task = repo.insert(input);
    return { task, deduped: false };
  } catch (err) {
    if (err instanceof DedupConflictError) {
      // Race: outro INSERT entre findByDedupKey e insert. Re-busca.
      if (input.dedupKey !== null) {
        const existing = repo.findByDedupKey(input.dedupKey);
        if (existing !== null) {
          return { task: existing, deduped: true };
        }
      }
    }
    throw err;
  }
}
