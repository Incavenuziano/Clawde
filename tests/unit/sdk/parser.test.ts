import { describe, expect, test } from "bun:test";
import {
  extractText,
  extractToolUses,
  isTextBlock,
  isToolUseBlock,
  parseRawMessage,
} from "@clawde/sdk";

describe("sdk/parser parseRawMessage", () => {
  test("string content vira TextBlock", () => {
    const m = parseRawMessage({ role: "user", content: "hello" });
    expect(m).not.toBeNull();
    expect(m?.role).toBe("user");
    expect(m?.blocks[0]).toEqual({ type: "text", text: "hello" });
  });

  test("array de blocks: text + tool_use + tool_result", () => {
    const m = parseRawMessage({
      role: "assistant",
      content: [
        { type: "text", text: "Vou listar arquivos" },
        { type: "tool_use", name: "Bash", input: { command: "ls" }, id: "tu_1" },
      ],
    });
    expect(m).not.toBeNull();
    expect(m?.blocks).toHaveLength(2);
    expect(isTextBlock(m!.blocks[0]!)).toBe(true);
    expect(isToolUseBlock(m!.blocks[1]!)).toBe(true);
  });

  test("tool_result preserva flags", () => {
    const m = parseRawMessage({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok", is_error: false }],
    });
    expect(m?.blocks[0]).toEqual({
      type: "tool_result",
      toolUseId: "tu_1",
      content: "ok",
      isError: false,
    });
  });

  test("role inválido retorna null", () => {
    expect(parseRawMessage({ role: "unknown", content: "x" })).toBeNull();
  });

  test("input non-object retorna null", () => {
    expect(parseRawMessage(null)).toBeNull();
    expect(parseRawMessage(42)).toBeNull();
    expect(parseRawMessage("string")).toBeNull();
  });

  test("default role assistant quando ausente", () => {
    const m = parseRawMessage({ content: "hello" });
    expect(m?.role).toBe("assistant");
  });
});

describe("sdk/parser helpers", () => {
  const message = {
    role: "assistant" as const,
    blocks: [
      { type: "text" as const, text: "primeiro" },
      { type: "tool_use" as const, name: "Bash", input: {}, id: "1" },
      { type: "text" as const, text: "segundo" },
    ],
  };

  test("extractText concatena só TextBlock com newlines", () => {
    expect(extractText(message)).toBe("primeiro\nsegundo");
  });

  test("extractToolUses filtra ToolUseBlock", () => {
    const uses = extractToolUses(message);
    expect(uses).toHaveLength(1);
    expect(uses[0]?.name).toBe("Bash");
  });
});
