/**
 * Mock controlável do AgentClient. Tests injetam mensagens scriptadas;
 * worker passa por todo o pipeline sem invocar SDK real.
 */

import { collectRun } from "@clawde/sdk";
import type { AgentClient, AgentRunResult, ParsedMessage, RunAgentOptions } from "@clawde/sdk";

export interface MockResponse {
  /** Mensagens emitidas em ordem. */
  readonly messages: ReadonlyArray<ParsedMessage>;
  /** Erro lançado após emitir mensagens (opcional). */
  readonly throwAfter?: Error;
  /** Delay (ms) entre mensagens; útil pra simular streaming. */
  readonly delayMs?: number;
}

export class MockAgentClient implements AgentClient {
  private responses: MockResponse[] = [];
  public readonly invocations: RunAgentOptions[] = [];

  constructor(initialResponse?: MockResponse) {
    if (initialResponse !== undefined) this.responses.push(initialResponse);
  }

  enqueueResponse(response: MockResponse): void {
    this.responses.push(response);
  }

  async *stream(options: RunAgentOptions): AsyncIterable<ParsedMessage> {
    this.invocations.push(options);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("MockAgentClient: no response enqueued");
    }
    for (const msg of response.messages) {
      if (response.delayMs !== undefined && response.delayMs > 0) {
        await new Promise((r) => setTimeout(r, response.delayMs));
      }
      yield msg;
    }
    if (response.throwAfter !== undefined) {
      throw response.throwAfter;
    }
  }

  run(options: RunAgentOptions): Promise<AgentRunResult> {
    return collectRun(this.stream(options));
  }
}

/**
 * Conveniência: ParsedMessage de assistant com texto.
 */
export function assistantText(text: string): ParsedMessage {
  return {
    role: "assistant",
    blocks: [{ type: "text", text }],
  };
}

/**
 * Conveniência: ParsedMessage de assistant com tool_use.
 */
export function assistantToolUse(
  name: string,
  input: Record<string, unknown>,
  id = "tu_test",
): ParsedMessage {
  return {
    role: "assistant",
    blocks: [{ type: "tool_use", name, input, id }],
  };
}

/**
 * Conveniência: tool_result message (role="user" no protocolo Anthropic).
 */
export function toolResult(toolUseId: string, content: string, isError = false): ParsedMessage {
  return {
    role: "user",
    blocks: [{ type: "tool_result", toolUseId, content, isError }],
  };
}
