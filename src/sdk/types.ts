/**
 * Tipos puros do domínio SDK do Clawde. Não importa @anthropic-ai/claude-agent-sdk
 * (mantém testes leves e permite swap futuro de implementação).
 *
 * Subset relevante. Mensagens reais do SDK têm mais campos; aqui ficam só os usados
 * no worker/persistência.
 */

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly id: string;
}

export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
  readonly isError: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ParsedMessage {
  readonly role: MessageRole;
  readonly blocks: ReadonlyArray<ContentBlock>;
  readonly raw?: unknown;
}

export type StopReason =
  | "completed"
  | "max_turns"
  | "error"
  | "user_abort"
  | "stop_requested"
  | "deferred";

export interface AgentRunResult {
  readonly stopReason: StopReason;
  readonly msgsConsumed: number;
  readonly totalTurns: number;
  readonly finalText: string;
  readonly error: string | null;
}

export class SdkAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SdkAuthError";
  }
}

export class SdkRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "SdkRateLimitError";
  }
}

export class SdkNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SdkNetworkError";
  }
}

export interface RunAgentOptions {
  readonly prompt: string;
  readonly sessionId?: string;
  readonly resumeSessionId?: string;
  readonly allowedTools?: ReadonlyArray<string>;
  readonly disallowedTools?: ReadonlyArray<string>;
  readonly maxTurns?: number;
  readonly appendSystemPrompt?: string;
  readonly workingDirectory?: string;
  readonly bare?: boolean;
}

/**
 * Cliente injetável. Worker usa esta interface; produção liga ao SDK real,
 * tests injetam mock determinístico (tests/mocks/sdk-mock.ts).
 */
export interface AgentClient {
  /**
   * Stream de ParsedMessage. Itera até stop_reason ou erro.
   */
  stream(options: RunAgentOptions): AsyncIterable<ParsedMessage>;

  /**
   * Conveniência: consome stream e agrega em AgentRunResult.
   * Implementação default em src/sdk/client.ts.
   */
  run(options: RunAgentOptions): Promise<AgentRunResult>;
}
