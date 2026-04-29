/**
 * Worker runner: pega próxima task pending, processa end-to-end.
 *
 * Pipeline:
 *   1. acquire lease (LeaseManager) → emit task_start
 *   2. invoke AgentClient.run() — mock em testes, real em produção
 *   3. quota tracker registra cada mensagem consumida
 *   4. finish lease com succeeded/failed
 *
 * Workspace ephemeral é OPCIONAL — controlado por task.workingDir + workspaceConfig.
 * Pra Fase 2 mantemos a porta aberta mas não exigimos.
 */

import type { EventsRepo } from "@clawde/db/repositories/events";
import type { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import type { TasksRepo } from "@clawde/db/repositories/tasks";
import type { Task, TaskRun } from "@clawde/domain/task";
import type { Logger } from "@clawde/log";
import type { QuotaTracker } from "@clawde/quota";
import type { AgentClient, AgentRunResult } from "@clawde/sdk";
import type { LeaseManager } from "./lease.ts";

export interface RunnerDeps {
  readonly tasksRepo: TasksRepo;
  readonly runsRepo: TaskRunsRepo;
  readonly eventsRepo: EventsRepo;
  readonly leaseManager: LeaseManager;
  readonly quotaTracker: QuotaTracker;
  readonly agentClient: AgentClient;
  readonly logger: Logger;
  readonly workerId: string;
}

export interface ProcessResult {
  readonly task: Task;
  readonly run: TaskRun;
  readonly agentResult: AgentRunResult;
}

/**
 * Processa 1 task end-to-end.
 *   - INSERT task_run (pending)
 *   - acquire lease (running) → events.task_start
 *   - invoke agent → stream messages, decrementar ledger
 *   - finish (succeeded/failed) → events.task_finish/task_fail
 */
export async function processTask(deps: RunnerDeps, task: Task): Promise<ProcessResult> {
  const log = deps.logger.child({ taskId: task.id });
  log.info("task processing", { agent: task.agent, priority: task.priority });

  const run = deps.runsRepo.insert(task.id, deps.workerId);
  const acquisition = deps.leaseManager.acquire(run.id);
  if (acquisition === null) {
    throw new Error(`failed to acquire lease for task_run ${run.id}`);
  }

  // Emite invocation_start.
  deps.eventsRepo.insert({
    taskRunId: run.id,
    sessionId: task.sessionId,
    traceId: null,
    spanId: null,
    kind: "claude_invocation_start",
    payload: { agent: task.agent, prompt_len: task.prompt.length },
  });

  let agentResult: AgentRunResult;
  try {
    agentResult = await runAgentWithLedger(deps, task, run.id);
  } catch (err) {
    log.error("agent invocation crashed", { error: (err as Error).message });
    const finished = deps.leaseManager.finish(acquisition, "failed", {
      error: (err as Error).message,
    });
    return {
      task,
      run: finished,
      agentResult: {
        stopReason: "error",
        msgsConsumed: 0,
        totalTurns: 0,
        finalText: "",
        error: (err as Error).message,
      },
    };
  }

  // Emite invocation_end.
  deps.eventsRepo.insert({
    taskRunId: run.id,
    sessionId: task.sessionId,
    traceId: null,
    spanId: null,
    kind: "claude_invocation_end",
    payload: {
      stop_reason: agentResult.stopReason,
      msgs_consumed: agentResult.msgsConsumed,
      total_turns: agentResult.totalTurns,
    },
  });

  const finalStatus = agentResult.error === null ? "succeeded" : "failed";
  const finished = deps.leaseManager.finish(acquisition, finalStatus, {
    result: agentResult.finalText.length > 0 ? agentResult.finalText : null,
    error: agentResult.error,
    msgsConsumed: agentResult.msgsConsumed,
  } as { result?: string; error?: string; msgsConsumed?: number });

  log.info("task finished", { status: finalStatus, msgs: agentResult.msgsConsumed });

  return { task, run: finished, agentResult };
}

/**
 * Itera pela próxima task pending e processa. Loop único — chamador (worker main)
 * decide quantas processar por invocação.
 */
export async function processNextPending(deps: RunnerDeps): Promise<ProcessResult | null> {
  const pending = deps.tasksRepo.findPending(1);
  if (pending.length === 0) return null;
  const task = pending[0];
  if (task === undefined) return null;
  return processTask(deps, task);
}

async function runAgentWithLedger(
  deps: RunnerDeps,
  task: Task,
  taskRunId: number,
): Promise<AgentRunResult> {
  let msgsConsumed = 0;
  let totalTurns = 0;
  const textParts: string[] = [];
  let lastRole: string | null = null;
  let stopReason: AgentRunResult["stopReason"] = "completed";
  let error: string | null = null;

  try {
    for await (const msg of deps.agentClient.stream({
      prompt: task.prompt,
      sessionId: task.sessionId ?? undefined,
      workingDirectory: task.workingDir ?? undefined,
    })) {
      msgsConsumed += 1;
      deps.quotaTracker.recordMessage(taskRunId);
      if (msg.role === "assistant") {
        if (lastRole !== "assistant") totalTurns += 1;
        const textBlocks = msg.blocks.filter((b) => b.type === "text");
        for (const b of textBlocks) {
          if (b.type === "text") textParts.push(b.text);
        }
      }
      lastRole = msg.role;
    }
  } catch (err) {
    error = (err as Error).message;
    stopReason = "error";
  }

  return {
    stopReason,
    msgsConsumed,
    totalTurns,
    finalText: textParts.join("\n").trim(),
    error,
  };
}
