/**
 * AgentClient: wrapper sobre @anthropic-ai/claude-agent-sdk com `query` async iterator.
 *
 * Lazy import do SDK pra: (a) reduzir cold start em comandos que não usam Claude,
 * (b) permitir mock injection em testes.
 */

import { extractText } from "./parser.ts";
import type {
  AgentClient,
  AgentRunResult,
  ParsedMessage,
  RunAgentOptions,
  StopReason,
} from "./types.ts";

/**
 * Helper: collect stream → AgentRunResult (compartilhado entre real e mock).
 */
export async function collectRun(
  stream: AsyncIterable<ParsedMessage>,
): Promise<AgentRunResult> {
  let msgsConsumed = 0;
  let totalTurns = 0;
  const textParts: string[] = [];
  let lastRole: ParsedMessage["role"] | null = null;
  let stopReason: StopReason = "completed";
  let error: string | null = null;

  try {
    for await (const msg of stream) {
      msgsConsumed += 1;
      if (msg.role === "assistant") {
        if (lastRole !== "assistant") totalTurns += 1;
        const text = extractText(msg);
        if (text.length > 0) textParts.push(text);
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

/**
 * Cliente real, baseado em @anthropic-ai/claude-agent-sdk.
 *
 * IMPORTANTE: stream() faz dynamic import (`await import(...)`) pra evitar
 * carregar o SDK em comandos que não invocam Claude (ex: `clawde quota status`).
 */
export class RealAgentClient implements AgentClient {
  async *stream(options: RunAgentOptions): AsyncIterable<ParsedMessage> {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const queryOptions: Record<string, unknown> = {
      prompt: options.prompt,
    };
    if (options.maxTurns !== undefined) queryOptions.maxTurns = options.maxTurns;
    if (options.allowedTools !== undefined) queryOptions.allowedTools = options.allowedTools;
    if (options.disallowedTools !== undefined) queryOptions.disallowedTools = options.disallowedTools;
    if (options.appendSystemPrompt !== undefined) {
      queryOptions.appendSystemPrompt = options.appendSystemPrompt;
    }
    if (options.workingDirectory !== undefined) queryOptions.cwd = options.workingDirectory;
    if (options.resumeSessionId !== undefined) queryOptions.resumeSessionId = options.resumeSessionId;

    // Lazy: parser.ts re-importado para evitar circularidade.
    const { parseRawMessage } = await import("./parser.ts");

    // sdk.query é async iterable de mensagens raw do SDK. Mapeamos pra ParsedMessage.
    // Tipagem do SDK pode mudar; aceitamos `any` aqui pelo escopo do wrapper.
    // biome-ignore lint/suspicious/noExplicitAny: SDK ainda em flux; tipo unknown via parseRawMessage
    const it = (sdk as { query: (...args: any[]) => AsyncIterable<unknown> }).query(queryOptions);
    for await (const raw of it) {
      const parsed = parseRawMessage(raw);
      if (parsed !== null) yield parsed;
    }
  }

  run(options: RunAgentOptions): Promise<AgentRunResult> {
    return collectRun(this.stream(options));
  }
}

/**
 * Singleton lazy. Em testes, pode-se substituir via setAgentClient.
 */
let activeClient: AgentClient | null = null;

export function getAgentClient(): AgentClient {
  if (activeClient === null) activeClient = new RealAgentClient();
  return activeClient;
}

export function setAgentClient(client: AgentClient | null): void {
  activeClient = client;
}
