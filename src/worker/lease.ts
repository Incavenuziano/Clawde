/**
 * LeaseManager: orquestra acquire/heartbeat/release sobre TaskRunsRepo,
 * emitindo events apropriados.
 *
 * Repo já tem lógica atômica (F1.T13). Este wrapper adiciona observabilidade
 * + auto heartbeat (intervalo configurável).
 */

import type { EventsRepo } from "@clawde/db/repositories/events";
import type { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import type { TaskRun, TaskRunStatus } from "@clawde/domain/task";

export interface LeaseAcquisition {
  readonly run: TaskRun;
  readonly stopHeartbeat: () => void;
}

export interface LeaseManagerConfig {
  readonly leaseSeconds: number;
  readonly heartbeatSeconds: number;
}

export class LeaseManager {
  constructor(
    private readonly runsRepo: TaskRunsRepo,
    private readonly eventsRepo: EventsRepo,
    private readonly config: LeaseManagerConfig,
  ) {}

  /**
   * Adquire lease + dispara heartbeat em background. Retorna função pra parar.
   * Null se concorrência venceu (run já não está pending).
   */
  acquire(taskRunId: number, traceId: string | null = null): LeaseAcquisition | null {
    const run = this.runsRepo.acquireLease(taskRunId, this.config.leaseSeconds);
    if (run === null) return null;

    this.eventsRepo.insert({
      taskRunId: run.id,
      sessionId: null,
      traceId,
      spanId: null,
      kind: "task_start",
      payload: { worker_id: run.workerId, attempt_n: run.attemptN },
    });

    const interval = setInterval(() => {
      this.runsRepo.heartbeat(run.id, this.config.leaseSeconds);
    }, this.config.heartbeatSeconds * 1000);
    // Permite que o processo termine mesmo com timer ativo (worker oneshot).
    interval.unref?.();

    return {
      run,
      stopHeartbeat: () => clearInterval(interval),
    };
  }

  /**
   * Finaliza lease. Para heartbeat se passado, transiciona status.
   */
  finish(
    acquisition: LeaseAcquisition,
    finalStatus: TaskRunStatus,
    extras: { result?: string; error?: string; msgsConsumed?: number } = {},
    traceId: string | null = null,
  ): TaskRun {
    acquisition.stopHeartbeat();
    const updated = this.runsRepo.transitionStatus(acquisition.run.id, finalStatus, extras);
    this.eventsRepo.insert({
      taskRunId: acquisition.run.id,
      sessionId: null,
      traceId,
      spanId: null,
      kind: finalStatus === "succeeded" ? "task_finish" : "task_fail",
      payload: {
        status: finalStatus,
        msgs_consumed: extras.msgsConsumed ?? 0,
        error: extras.error ?? null,
      },
    });
    return updated;
  }
}
