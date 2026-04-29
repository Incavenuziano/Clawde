/**
 * Hooks pipeline conforme BLUEPRINT §4.
 *
 * Um hook recebe payload tipado, retorna HookOutput. Worker invoca hooks em
 * pontos definidos do ciclo de vida do agente.
 */

export type HookName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop";

export interface HookCommonInput {
  readonly hook: HookName;
  readonly sessionId: string;
  readonly taskRunId?: number;
  readonly traceId?: string;
  readonly ts: string;
}

export interface SessionStartPayload {
  readonly agent: string;
  readonly workingDir: string;
}

export interface UserPromptSubmitPayload {
  readonly prompt: string;
  readonly source?: "cli" | "telegram" | "webhook-github" | "webhook-generic";
}

export interface PreToolUsePayload {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
}

export interface PostToolUsePayload {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly toolOutput: unknown;
  readonly durationMs: number;
  readonly exitCode?: number;
}

export interface StopPayload {
  readonly reason: "completed" | "max_turns" | "error" | "user_abort";
  readonly msgsConsumed: number;
  readonly totalTurns: number;
  readonly finalText?: string;
}

export type HookInput =
  | (HookCommonInput & { hook: "SessionStart"; payload: SessionStartPayload })
  | (HookCommonInput & { hook: "UserPromptSubmit"; payload: UserPromptSubmitPayload })
  | (HookCommonInput & { hook: "PreToolUse"; payload: PreToolUsePayload })
  | (HookCommonInput & { hook: "PostToolUse"; payload: PostToolUsePayload })
  | (HookCommonInput & { hook: "Stop"; payload: StopPayload });

export interface HookOutput {
  readonly ok: boolean;
  /**
   * Se true em UserPromptSubmit/PreToolUse, bloqueia ação subsequente.
   * Ignorado em SessionStart/PostToolUse/Stop.
   */
  readonly block?: boolean;
  /** Mensagem para registrar em events.payload. */
  readonly message?: string;
  /** Eventos extras a appender além dos default. */
  readonly extraEvents?: ReadonlyArray<{
    kind: string;
    payload: Record<string, unknown>;
  }>;
}

/**
 * Handler tipado por hook (in-process, sem subprocess).
 */
export type HookHandler<I extends HookInput> = (input: I) => Promise<HookOutput> | HookOutput;
