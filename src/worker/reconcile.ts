/**
 * Reconcile no startup: detecta task_runs com lease expirado (worker zumbi
 * killado mid-execução) e re-enfileira via attempt_n+1.
 */

import type { EventsRepo } from "@clawde/db/repositories/events";
import type { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import type { TasksRepo } from "@clawde/db/repositories/tasks";
import type { TaskRun } from "@clawde/domain/task";
import { cleanupOrphanWorkspaceSync } from "./workspace.ts";

export interface ReconcileResult {
  readonly expired: ReadonlyArray<TaskRun>;
  readonly reenqueued: ReadonlyArray<{ taskId: number; newRunId: number }>;
  readonly cleanedOrphans: number;
}

export interface Reconciler {
  reconcile(workerId: string): ReconcileResult;
}

export function makeReconciler(
  runsRepo: TaskRunsRepo,
  eventsRepo: EventsRepo,
  options?: { tasksRepo?: TasksRepo; workspaceTmpRoot?: string },
): Reconciler {
  return {
    reconcile(workerId: string): ReconcileResult {
      const expired = runsRepo.findExpiredLeases();
      const reenqueued: Array<{ taskId: number; newRunId: number }> = [];
      let cleanedOrphans = 0;

      for (const run of expired) {
        // Marca como abandoned.
        runsRepo.transitionStatus(run.id, "abandoned", {
          error: "lease expired (worker likely crashed)",
        });
        eventsRepo.insert({
          taskRunId: run.id,
          sessionId: null,
          traceId: null,
          spanId: null,
          kind: "lease_expired",
          payload: { worker_id: run.workerId, attempt_n: run.attemptN },
        });
        // Re-enfileira via attempt_n+1.
        const newRun = runsRepo.insert(run.taskId, workerId);
        reenqueued.push({ taskId: run.taskId, newRunId: newRun.id });

        const task = options?.tasksRepo?.findById(run.taskId);
        if (task?.workingDir !== null && task?.workingDir !== undefined) {
          try {
            if (cleanupOrphanWorkspaceSync(task.workingDir, run.id, options?.workspaceTmpRoot)) {
              cleanedOrphans += 1;
            }
          } catch {
            // best-effort cleanup.
          }
        }
      }

      return { expired, reenqueued, cleanedOrphans };
    },
  };
}
