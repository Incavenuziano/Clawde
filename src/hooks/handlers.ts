/**
 * Handlers default. Cada um registra evento mínimo via EventCallback (injetado)
 * e, opcionalmente, persiste observation em memory via MemoryCallback (F5.T50).
 *
 * Implementações específicas (prompt-guard real, sanitização de input externo)
 * virão em Fase 6.
 */

import type { ObservationKind } from "@clawde/domain/memory";
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

/**
 * F5.T50: callback opcional pra persistir observation em memory_observations.
 * Quando undefined, hook só emite event (comportamento Fase 2).
 */
export type MemoryCallback = (input: {
  sessionId: string;
  kind: ObservationKind;
  content: string;
  importance: number;
}) => void;

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
  memoryCallback?: MemoryCallback,
): HookHandler<HookInput & { hook: "PostToolUse"; payload: PostToolUsePayload }> {
  return (input) => {
    emit("tool_result", {
      tool: input.payload.toolName,
      duration_ms: input.payload.durationMs,
      exit_code: input.payload.exitCode ?? null,
    });
    if (memoryCallback !== undefined) {
      // Resumo concise do tool use pra observation searchable.
      const summary = `tool=${input.payload.toolName} duration=${input.payload.durationMs}ms${
        input.payload.exitCode !== undefined ? ` exit=${input.payload.exitCode}` : ""
      }`;
      memoryCallback({
        sessionId: input.sessionId,
        kind: "observation",
        content: summary,
        importance: 0.4, // tool calls são baixa importância por default
      });
    }
    return { ok: true };
  };
}

export function makeStopHandler(
  emit: EventCallback,
  memoryCallback?: MemoryCallback,
): HookHandler<HookInput & { hook: "Stop"; payload: StopPayload }> {
  return (input) => {
    emit("session_stop_hook", {
      reason: input.payload.reason,
      msgs_consumed: input.payload.msgsConsumed,
      total_turns: input.payload.totalTurns,
    });
    if (memoryCallback !== undefined && input.payload.finalText !== undefined) {
      // Stop com finalText é summary de alto valor — importance maior.
      const truncated = input.payload.finalText.slice(0, 2000);
      memoryCallback({
        sessionId: input.sessionId,
        kind: "summary",
        content: truncated,
        importance: 0.6,
      });
    }
    return { ok: true } as HookOutput;
  };
}
