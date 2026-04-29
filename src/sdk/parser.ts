/**
 * Helpers de parsing/agregação sobre ParsedMessage.
 * Padrões inspirados em claude-mem/src/sdk/parser.ts.
 */

import type { ContentBlock, ParsedMessage, TextBlock, ToolUseBlock } from "./types.ts";

export function isTextBlock(b: ContentBlock): b is TextBlock {
  return b.type === "text";
}

export function isToolUseBlock(b: ContentBlock): b is ToolUseBlock {
  return b.type === "tool_use";
}

/**
 * Extrai texto concatenado de uma mensagem (skip tool_use/tool_result).
 */
export function extractText(message: ParsedMessage): string {
  return message.blocks
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n");
}

/**
 * Lista tool_uses de uma mensagem.
 */
export function extractToolUses(message: ParsedMessage): ReadonlyArray<ToolUseBlock> {
  return message.blocks.filter(isToolUseBlock);
}

/**
 * Tenta interpretar a raw message do SDK Anthropic em ParsedMessage.
 * O formato do SDK varia entre versões — esta função é defensiva.
 *
 * Espera entrada com `{type, role?, content?: array | string}`.
 */
export function parseRawMessage(raw: unknown): ParsedMessage | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const role = (obj.role ?? obj.message_role ?? "assistant") as string;
  if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") {
    return null;
  }

  const content = obj.content ?? obj.text ?? obj.message;
  const blocks: ContentBlock[] = [];

  if (typeof content === "string") {
    blocks.push({ type: "text", text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") {
        blocks.push({ type: "text", text: item });
        continue;
      }
      if (item === null || typeof item !== "object") continue;
      const b = item as Record<string, unknown>;
      const btype = b.type;
      if (btype === "text" && typeof b.text === "string") {
        blocks.push({ type: "text", text: b.text });
      } else if (btype === "tool_use") {
        blocks.push({
          type: "tool_use",
          name: String(b.name ?? "unknown"),
          input: (b.input ?? {}) as Readonly<Record<string, unknown>>,
          id: String(b.id ?? ""),
        });
      } else if (btype === "tool_result") {
        blocks.push({
          type: "tool_result",
          toolUseId: String(b.tool_use_id ?? b.toolUseId ?? ""),
          content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
          isError: Boolean(b.is_error ?? b.isError ?? false),
        });
      }
    }
  }

  return { role: role as ParsedMessage["role"], blocks, raw };
}
