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

export interface PreToolUseAgentPolicy {
  readonly allowedTools: ReadonlyArray<string>;
  readonly sandbox: {
    readonly level: 1 | 2 | 3;
    readonly allowed_writes: ReadonlyArray<string>;
  };
}

function summarizeBashCommand(toolInput: Readonly<Record<string, unknown>>): string {
  const raw = toolInput.command;
  if (typeof raw !== "string") return "";
  return raw.slice(0, 80);
}

function extractPath(toolInput: Readonly<Record<string, unknown>>): string {
  const candidates = [toolInput.path, toolInput.file_path];
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function estimateWriteBytes(toolInput: Readonly<Record<string, unknown>>): number {
  const candidates = [
    toolInput.content,
    toolInput.text,
    toolInput.newText,
    toolInput.new_str,
    toolInput.old_str,
    toolInput.patch,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return Buffer.byteLength(candidate, "utf-8");
    }
  }
  return 0;
}

function summarizeToolUse(
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (toolName === "Bash") {
    return {
      tool_name: "Bash",
      command_summary: summarizeBashCommand(toolInput),
    };
  }
  if (toolName === "Read") {
    return {
      tool_name: "Read",
      path: extractPath(toolInput),
    };
  }
  if (toolName === "Edit" || toolName === "Write") {
    return {
      tool_name: toolName,
      path: extractPath(toolInput),
      bytes_count: estimateWriteBytes(toolInput),
    };
  }
  return { tool_name: toolName };
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").trim();
}

function isPathTraversal(path: string): boolean {
  const p = normalizePath(path);
  return p.includes("../") || p.startsWith("..");
}

function isAllowedWritePath(path: string, allowedWrites: ReadonlyArray<string>): boolean {
  const target = normalizePath(path);
  if (isPathTraversal(target)) return false;
  for (const allowed of allowedWrites) {
    const base = normalizePath(allowed);
    if (base.length === 0) continue;
    if (target === base || target.startsWith(`${base}/`)) return true;
  }
  return false;
}

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
  agent?: PreToolUseAgentPolicy,
): HookHandler<HookInput & { hook: "PreToolUse"; payload: PreToolUsePayload }> {
  return (input) => {
    const toolName = input.payload.toolName;
    const allowedTools = agent?.allowedTools ?? [];

    if (allowedTools.length > 0 && !allowedTools.includes(toolName)) {
      emit("tool_blocked", {
        tool: toolName,
        reason: "tool_not_allowlisted",
      });
      return { ok: false, block: true, message: `tool '${toolName}' not allowed` };
    }

    if (toolName === "Bash" && (agent?.sandbox.level ?? 1) >= 2) {
      emit("tool_blocked", {
        tool: toolName,
        reason: "bash_requires_subprocess_wrapper",
        sandbox_level: agent?.sandbox.level ?? 1,
      });
      return {
        ok: false,
        block: true,
        message: "Bash blocked on sandbox level>=2 until subprocess wrapper is available",
      };
    }

    if (toolName === "Edit" || toolName === "Write") {
      const path = extractPath(input.payload.toolInput);
      const allowedWrites = agent?.sandbox.allowed_writes ?? [];
      if (allowedWrites.length > 0 && !isAllowedWritePath(path, allowedWrites)) {
        emit("tool_blocked", {
          tool: toolName,
          reason: "write_path_not_allowed",
          path,
        });
        return { ok: false, block: true, message: `write path '${path}' is not allowed` };
      }
    }

    emit("tool_use", summarizeToolUse(input.payload.toolName, input.payload.toolInput));
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
