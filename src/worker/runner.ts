/**
 * Worker runner: pega próxima task pending, processa end-to-end.
 *
 * Pipeline:
 *   1. acquire lease (LeaseManager) → emit task_start
 *   2. (opcional) buildMemoryContext + prepend ao prompt
 *   3. invoke AgentClient.run() — mock em testes, real em produção
 *      OR runReviewPipeline quando review.enabled=true
 *   4. quota tracker registra cada mensagem consumida
 *   5. finish lease com succeeded/failed
 *
 * Workspace ephemeral é OPCIONAL — controlado por task.workingDir + workspaceConfig.
 */

import {
  type SetupTokenRunner,
  invokeWithAutoRefresh,
  spawnClaudeSetupToken,
} from "@clawde/auth/refresh";
import type { EventsRepo } from "@clawde/db/repositories/events";
import type { MemoryRepo } from "@clawde/db/repositories/memory";
import type { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import type { TasksRepo } from "@clawde/db/repositories/tasks";
import type { QuotaPolicy } from "@clawde/domain/quota";
import { deriveSessionId } from "@clawde/domain/session";
import type { Task, TaskRun, TaskSource } from "@clawde/domain/task";
import { type PreToolUsePayload, makePreToolUseHandler } from "@clawde/hooks";
import type { Logger } from "@clawde/log";
import type { MemoryAwareConfig, buildMemoryContext as buildMemoryContextFn } from "@clawde/memory";
import type { QuotaTracker } from "@clawde/quota";
import type { PipelineConfig, runReviewPipeline as runReviewPipelineFn } from "@clawde/review";
import { composeAppendSystemPrompt } from "@clawde/sanitize";
import {
  type AgentClient,
  type AgentRunResult,
  SdkAuthError,
  SdkNetworkError,
  SdkRateLimitError,
} from "@clawde/sdk";
import type { LeaseManager } from "./lease.ts";
import {
  type AgentDefinitionLike,
  createWorkspace,
  removeWorkspace,
  shouldUseEphemeralWorkspace,
} from "./workspace.ts";

export interface MemoryInjectDeps {
  readonly memoryRepo: MemoryRepo;
  readonly config: MemoryAwareConfig;
  readonly buildContext: typeof buildMemoryContextFn;
}

export interface ReviewPipelineDeps {
  readonly config: PipelineConfig;
  readonly run: typeof runReviewPipelineFn;
}

export interface RunnerDeps {
  readonly tasksRepo: TasksRepo;
  readonly runsRepo: TaskRunsRepo;
  readonly eventsRepo: EventsRepo;
  readonly leaseManager: LeaseManager;
  readonly quotaTracker: QuotaTracker;
  readonly quotaPolicy: QuotaPolicy;
  readonly agentClient: AgentClient;
  readonly logger: Logger;
  readonly workerId: string;
  readonly workspaceConfig?: { tmpRoot: string; baseBranch: string };
  readonly resolveAgentDefinition?: (agent: string) => Promise<AgentDefinitionLike | null>;
  /** Overrides para fluxo de auto-refresh em testes. */
  readonly authRefresh?: {
    readonly runSetupToken?: SetupTokenRunner;
    readonly reloadToken?: () => {
      value: string;
      source: "systemd-credential" | "keychain" | "env";
    };
  };
  /** Opt-in: injeta memory context antes do prompt. */
  readonly memoryInject?: MemoryInjectDeps;
  /** Opt-in: roda review pipeline ao invés de invocação simples. */
  readonly review?: ReviewPipelineDeps;
}

export interface ProcessResult {
  readonly task: Task;
  readonly run: TaskRun;
  readonly agentResult: AgentRunResult;
}

class LeaseBusyError extends Error {
  constructor(
    readonly taskId: number,
    readonly taskRunId: number,
  ) {
    super(`lease busy for task ${taskId} run ${taskRunId}`);
    this.name = "LeaseBusyError";
  }
}

/**
 * Sources cujo prompt vem de um caminho confiável (CLI direto do operador ou
 * outro agente do próprio sistema). Demais sources (telegram, webhook, cron)
 * são tratadas como "external" e ganham `EXTERNAL_INPUT_SYSTEM_PROMPT` em
 * `appendSystemPrompt` pra defesa contra prompt injection.
 */
const TRUSTED_SOURCES: ReadonlySet<TaskSource> = new Set(["cli", "subagent"]);

function isExternalSource(source: TaskSource): boolean {
  return !TRUSTED_SOURCES.has(source);
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

  const quotaWindow = deps.quotaTracker.currentWindow();
  const quotaDecision = deps.quotaPolicy.canAccept(quotaWindow, task.priority);

  const latest = deps.runsRepo.findLatestByTaskId(task.id);
  let run: TaskRun;
  if (latest === null) {
    run = deps.runsRepo.insert(task.id, deps.workerId);
  } else if (latest.status === "pending") {
    run = latest;
  } else {
    throw new LeaseBusyError(task.id, latest.id);
  }

  if (!quotaDecision.accept) {
    if (quotaDecision.deferUntil !== null) {
      const previousNotBefore = run.notBefore;
      run = deps.runsRepo.setNotBefore(run.id, quotaDecision.deferUntil);
      if (previousNotBefore !== quotaDecision.deferUntil) {
        deps.eventsRepo.insert({
          taskRunId: run.id,
          sessionId: task.sessionId,
          traceId: null,
          spanId: null,
          kind: "task_deferred",
          payload: {
            task_id: task.id,
            priority: task.priority,
            state: quotaWindow.state,
            defer_until: quotaDecision.deferUntil,
            reason: quotaDecision.reason,
          },
        });
      }
    }

    log.info("task deferred by quota policy", {
      state: quotaWindow.state,
      defer_until: quotaDecision.deferUntil,
    });
    return {
      task,
      run,
      agentResult: {
        stopReason: "deferred",
        msgsConsumed: 0,
        totalTurns: 0,
        finalText: "",
        error: null,
      },
    };
  }

  const acquisition = deps.leaseManager.acquire(run.id);
  if (acquisition === null) {
    throw new LeaseBusyError(task.id, run.id);
  }

  const workspaceConfig = deps.workspaceConfig ?? { tmpRoot: "/tmp", baseBranch: "main" };
  let agentDef: AgentDefinitionLike | null = null;
  if (deps.resolveAgentDefinition !== undefined) {
    agentDef = await deps.resolveAgentDefinition(task.agent);
    if (agentDef === null) {
      throw new Error(`agent '${task.agent}' not found in AGENT.md definitions`);
    }
  }
  let ephemeralWorkspacePath: string | null = null;
  if (task.workingDir !== null && agentDef !== null) {
    if (shouldUseEphemeralWorkspace(task, agentDef)) {
      const ws = await createWorkspace({
        taskRunId: run.id,
        taskId: task.id,
        slug: task.prompt.slice(0, 40),
        baseBranch: workspaceConfig.baseBranch,
        repoRoot: task.workingDir,
        tmpRoot: workspaceConfig.tmpRoot,
      });
      ephemeralWorkspacePath = ws.path;
    }
  }

  try {
    // T-055: prior_context (memory) é tratado como SYSTEM PROMPT confiável,
    // não como user content. Capturamos o snippet aqui mas a injeção é via
    // `composeAppendSystemPrompt` lá embaixo (no streamOpts), separando-o do
    // user-provided external input que continua dentro de `<external_input>`
    // no user prompt.
    const effectivePrompt = task.prompt;
    let memorySnippet: string | null = null;
    if (deps.memoryInject?.config.enabled) {
      try {
        const ctx = await deps.memoryInject.buildContext(
          deps.memoryInject.memoryRepo,
          task.prompt,
          deps.memoryInject.config,
        );
        if (ctx.injected) {
          memorySnippet = ctx.snippet;
        }
      } catch (err) {
        log.warn("memory inject failed (continuing without)", { error: (err as Error).message });
      }
    }

    // Emite invocation_start.
    deps.eventsRepo.insert({
      taskRunId: run.id,
      sessionId: task.sessionId,
      traceId: null,
      spanId: null,
      kind: "claude_invocation_start",
      payload: { agent: task.agent, prompt_len: effectivePrompt.length },
    });

    let agentResult: AgentRunResult;
    try {
      agentResult =
        deps.review !== undefined
          ? await runWithReviewPipeline(
              deps,
              task,
              run.id,
              run.attemptN,
              effectivePrompt,
              ephemeralWorkspacePath,
              agentDef,
              memorySnippet,
            )
          : await runAgentWithLedger(
              deps,
              task,
              run.id,
              effectivePrompt,
              ephemeralWorkspacePath,
              agentDef,
              memorySnippet,
            );
    } catch (err) {
      if (err instanceof SdkRateLimitError) {
        deps.quotaTracker.markCurrentWindowExhausted();
        const exhaustedWindow = deps.quotaTracker.currentWindow();
        const failed = deps.leaseManager.finish(acquisition, "failed", {
          error: err.message,
        });
        const deferred = deps.runsRepo.insert(task.id, deps.workerId, {
          notBefore: exhaustedWindow.resetsAt,
        });
        deps.eventsRepo.insert({
          taskRunId: failed.id,
          sessionId: task.sessionId,
          traceId: null,
          spanId: null,
          kind: "quota_429_observed",
          payload: {
            task_id: task.id,
            failed_run_id: failed.id,
            deferred_run_id: deferred.id,
            retry_after_seconds: err.retryAfterSeconds,
            defer_until: exhaustedWindow.resetsAt,
          },
        });
        return {
          task,
          run: deferred,
          agentResult: {
            stopReason: "error",
            msgsConsumed: 0,
            totalTurns: 0,
            finalText: "",
            error: err.message,
          },
        };
      }

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
  } finally {
    if (ephemeralWorkspacePath !== null && task.workingDir !== null) {
      try {
        await removeWorkspace(
          {
            path: ephemeralWorkspacePath,
            baseBranch: workspaceConfig.baseBranch,
            featureBranch: "",
            taskRunId: run.id,
            createdAt: "",
          },
          task.workingDir,
        );
      } catch (err) {
        log.warn("workspace cleanup failed", {
          error: (err as Error).message,
          path: ephemeralWorkspacePath,
        });
      }
    }
  }
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
  try {
    return await processTask(deps, task);
  } catch (err) {
    if (err instanceof LeaseBusyError) return null;
    throw err;
  }
}

async function runAgentWithLedger(
  deps: RunnerDeps,
  task: Task,
  taskRunId: number,
  effectivePrompt: string,
  workingDirectoryOverride: string | null,
  agentDef: AgentDefinitionLike | null,
  memorySnippet: string | null,
): Promise<AgentRunResult> {
  const AUTH_RETRY_TOKEN = { value: "worker-auth-retry", source: "env" as const };

  let msgsConsumed = 0;
  let totalTurns = 0;
  const textParts: string[] = [];
  let lastRole: string | null = null;
  let stopReason: AgentRunResult["stopReason"] = "completed";
  let error: string | null = null;

  const streamOpts: {
    prompt: string;
    sessionId?: string;
    workingDirectory?: string;
    appendSystemPrompt?: string;
    allowedTools?: ReadonlyArray<string>;
    disallowedTools?: ReadonlyArray<string>;
    maxTurns?: number;
  } = {
    prompt: effectivePrompt,
  };
  const allowedTools = agentDef?.frontmatter?.allowedTools ?? [];
  const disallowedTools = new Set(agentDef?.frontmatter?.disallowedTools ?? []);
  if ((agentDef?.sandbox?.level ?? 1) >= 2) {
    disallowedTools.add("Bash");
  }
  if (allowedTools.length > 0) streamOpts.allowedTools = allowedTools;
  if (disallowedTools.size > 0) streamOpts.disallowedTools = [...disallowedTools];
  if (agentDef?.frontmatter?.maxTurns !== undefined) {
    streamOpts.maxTurns = agentDef.frontmatter.maxTurns;
  }

  const preToolHandler = makePreToolUseHandler(() => {}, {
    allowedTools,
    sandbox: {
      level: agentDef?.sandbox?.level ?? 1,
      allowed_writes: agentDef?.sandbox?.allowed_writes ?? [],
    },
  });
  if (task.sessionId !== null) streamOpts.sessionId = task.sessionId;
  if (workingDirectoryOverride !== null) {
    streamOpts.workingDirectory = workingDirectoryOverride;
  } else if (task.workingDir !== null) {
    streamOpts.workingDirectory = task.workingDir;
  }
  // T-054 + T-055: appendSystemPrompt compõe (sem sobrescrever):
  //   EXTERNAL_INPUT_SYSTEM_PROMPT (quando source é externa)
  //   + prior_context (memory snippet — sempre system prompt confiável).
  // user prompt continua com o `<external_input>` envelope quando aplicável.
  const appendSystem = composeAppendSystemPrompt({
    externalInputSafety: isExternalSource(task.source),
    ...(memorySnippet !== null ? { priorContext: memorySnippet } : {}),
  });
  if (appendSystem !== undefined) {
    streamOpts.appendSystemPrompt = appendSystem;
  }

  const runStreamOnce = async (): Promise<void> => {
    for await (const msg of deps.agentClient.stream(streamOpts)) {
      msgsConsumed += 1;
      deps.quotaTracker.recordMessage(taskRunId);
      if (msg.role === "assistant") {
        if (lastRole !== "assistant") totalTurns += 1;
        for (const b of msg.blocks) {
          if (b.type === "text") {
            textParts.push(b.text);
            continue;
          }
          if (b.type === "tool_use") {
            const maybeGate = preToolHandler({
              hook: "PreToolUse",
              sessionId: task.sessionId ?? "worker-session",
              taskRunId,
              ts: new Date().toISOString(),
              payload: {
                toolName: b.name,
                toolInput: b.input as PreToolUsePayload["toolInput"],
              },
            });
            const gate = maybeGate instanceof Promise ? await maybeGate : maybeGate;
            if (!gate.ok && gate.block) {
              throw new Error(gate.message ?? `tool '${b.name}' blocked by policy`);
            }
          }
        }
      }
      lastRole = msg.role;
    }
  };

  try {
    await invokeWithAutoRefresh(
      AUTH_RETRY_TOKEN,
      async () => {
        await runStreamOnce();
      },
      {
        runSetupToken: deps.authRefresh?.runSetupToken ?? spawnClaudeSetupToken,
        reloadToken: deps.authRefresh?.reloadToken ?? (() => AUTH_RETRY_TOKEN),
      },
    );
  } catch (err) {
    if (err instanceof SdkRateLimitError || err instanceof SdkNetworkError) {
      throw err;
    }
    if (err instanceof SdkAuthError) {
      deps.eventsRepo.insert({
        taskRunId,
        sessionId: task.sessionId,
        traceId: null,
        spanId: null,
        kind: "sdk_auth_error",
        payload: { error: err.message },
      });
      throw err;
    }
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

/**
 * Roda review pipeline: cada stage invoca o agentClient com system prompt
 * canônico do role. Quota é debitada por mensagem em todos os stages.
 *
 * stopReason e msgsConsumed são agregados ao longo de todos os stages.
 */
async function runWithReviewPipeline(
  deps: RunnerDeps,
  task: Task,
  taskRunId: number,
  attemptN: number,
  effectivePrompt: string,
  workingDirectoryOverride: string | null,
  agentDef: AgentDefinitionLike | null,
  memorySnippet: string | null,
): Promise<AgentRunResult> {
  if (deps.review === undefined) {
    throw new Error("runWithReviewPipeline called without review deps");
  }
  let msgsConsumed = 0;
  let totalStageRuns = 0;

  const stageRunner: import("@clawde/review").StageRunner = async (inv) => {
    const parts: string[] = [];
    // T-059: prompt do user contém apenas inv.prompt (sem systemPrompt
    // concatenado). System prompt do role vai pra appendSystemPrompt via
    // composeAppendSystemPrompt.rolePrompt — separação semântica entre
    // instrução curada (system) e conteúdo da iteração (user).
    const stageWorkingDir = workingDirectoryOverride ?? task.workingDir ?? "/no-workspace";
    const streamOpts: {
      prompt: string;
      sessionId?: string;
      workingDirectory?: string;
      appendSystemPrompt?: string;
      allowedTools?: ReadonlyArray<string>;
      disallowedTools?: ReadonlyArray<string>;
      maxTurns?: number;
    } = {
      prompt: inv.prompt,
    };
    if (agentDef?.frontmatter?.maxTurns !== undefined) {
      streamOpts.maxTurns = agentDef.frontmatter.maxTurns;
    }
    if (agentDef?.frontmatter?.allowedTools?.length) {
      streamOpts.allowedTools = agentDef.frontmatter.allowedTools;
    }
    if (agentDef?.frontmatter?.disallowedTools?.length) {
      streamOpts.disallowedTools = agentDef.frontmatter.disallowedTools;
    }
    // T-058: deriva sessionId fresh por stage. Cada role roda em contexto
    // próprio (não compartilhado com task.sessionId nem entre stages), garantindo
    // que reviewers não vejam contexto do implementer e vice-versa. Inclui
    // attemptN pra que retries também ganhem sessões novas.
    streamOpts.sessionId = deriveSessionId({
      agent: inv.role,
      workingDir: stageWorkingDir,
      intent: `task-${task.id}-${inv.role}-attempt-${attemptN}`,
    });
    if (workingDirectoryOverride !== null) {
      streamOpts.workingDirectory = workingDirectoryOverride;
    } else if (task.workingDir !== null) {
      streamOpts.workingDirectory = task.workingDir;
    }
    // T-054 + T-055 + T-059: appendSystemPrompt compõe rolePrompt (do stage),
    // EXTERNAL_INPUT_SYSTEM_PROMPT (quando source externa) e prior_context
    // (memory) sem sobrescrever uns aos outros.
    const appendSystemReview = composeAppendSystemPrompt({
      rolePrompt: inv.systemPrompt,
      externalInputSafety: isExternalSource(task.source),
      ...(memorySnippet !== null ? { priorContext: memorySnippet } : {}),
    });
    if (appendSystemReview !== undefined) {
      streamOpts.appendSystemPrompt = appendSystemReview;
    }
    for await (const msg of deps.agentClient.stream(streamOpts)) {
      msgsConsumed += 1;
      deps.quotaTracker.recordMessage(taskRunId);
      if (msg.role === "assistant") {
        const textBlocks = msg.blocks.filter((b) => b.type === "text");
        for (const b of textBlocks) {
          if (b.type === "text") parts.push(b.text);
        }
      }
    }
    totalStageRuns += 1;
    return parts.join("\n").trim();
  };

  try {
    const result = await deps.review.run(effectivePrompt, deps.review.config, {
      runner: stageRunner,
      onStage: (s) => {
        const stageEvent =
          s.role === "implementer"
            ? "review.implementer.end"
            : s.role === "spec-reviewer"
              ? "review.spec.verdict"
              : "review.quality.verdict";
        deps.eventsRepo.insert({
          taskRunId,
          sessionId: task.sessionId,
          traceId: null,
          spanId: null,
          kind: stageEvent,
          payload: {
            attempt_n: s.attemptN,
            ...(s.verdict !== undefined && { verdict: s.verdict }),
          },
        });
      },
    });

    deps.eventsRepo.insert({
      taskRunId,
      sessionId: task.sessionId,
      traceId: null,
      spanId: null,
      kind: result.status === "approved" ? "review.pipeline.complete" : "review.pipeline.exhausted",
      payload: {
        rounds: result.totalRoundsRun,
        status: result.status,
        msgs_consumed: msgsConsumed,
      },
    });

    return {
      stopReason: result.status === "approved" ? "completed" : "max_turns",
      msgsConsumed,
      totalTurns: totalStageRuns,
      finalText: result.finalOutput ?? "",
      error: result.status === "approved" ? null : "review pipeline exhausted retries",
    };
  } catch (err) {
    return {
      stopReason: "error",
      msgsConsumed,
      totalTurns: totalStageRuns,
      finalText: "",
      error: (err as Error).message,
    };
  }
}
