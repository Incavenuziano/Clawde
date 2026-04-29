/**
 * Handlers default no-op. Cada um registra evento mínimo via callback (injetado).
 * Implementações específicas (prompt-guard, memory observer) virão em fases futuras.
 */

import type {
  HookHandler,
  HookInput,
  HookOutput,
  PostToolUsePayload,
  PreToolUsePayload,
  SessionStartPayload,
  StopPayload,
  UserPromptSubmitPayload,
} from "./types.ts";

export type EventCallback = (kind: string, payload: Record<string, unknown>) => void;

export function makeSessionStartHandler(
  emit: EventCallback,
): HookHandler<HookInput & { hook: "SessionStart"; payload: SessionStartPayload }> {
  return (input) => {
    emit("session_start_hook", { agent: input.payload.agent });
    return { ok: true };
  };
}

export function makeUserPromptSubmitHandler(
  emit: EventCallback,
): HookHandler<HookInput & { hook: "UserPromptSubmit"; payload: UserPromptSubmitPayload }> {
  return (input) => {
    // No-op por padrão; prompt-guard real virá em Fase 6 (sanitização).
    emit("user_prompt_submit_hook", {
      source: input.payload.source ?? "unknown",
      prompt_len: input.payload.prompt.length,
    });
    return { ok: true };
  };
}

export function makePreToolUseHandler(
  emit: EventCallback,
): HookHandler<HookInput & { hook: "PreToolUse"; payload: PreToolUsePayload }> {
  return (input) => {
    emit("tool_use", { tool: input.payload.toolName, input: input.payload.toolInput });
    return { ok: true };
  };
}

export function makePostToolUseHandler(
  emit: EventCallback,
): HookHandler<HookInput & { hook: "PostToolUse"; payload: PostToolUsePayload }> {
  return (input) => {
    emit("tool_result", {
      tool: input.payload.toolName,
      duration_ms: input.payload.durationMs,
      exit_code: input.payload.exitCode ?? null,
    });
    return { ok: true };
  };
}

export function makeStopHandler(
  emit: EventCallback,
): HookHandler<HookInput & { hook: "Stop"; payload: StopPayload }> {
  return (input) => {
    emit("session_stop_hook", {
      reason: input.payload.reason,
      msgs_consumed: input.payload.msgsConsumed,
      total_turns: input.payload.totalTurns,
    });
    return { ok: true } as HookOutput;
  };
}
