import { describe, expect, test } from "bun:test";
import { collectRun } from "@clawde/sdk";
import {
  MockAgentClient,
  assistantText,
  assistantToolUse,
  toolResult,
} from "../../mocks/sdk-mock.ts";

describe("sdk/client collectRun (via MockAgentClient)", () => {
  test("agrega 3 messages assistant em finalText e msgsConsumed=3", async () => {
    const mock = new MockAgentClient({
      messages: [assistantText("Olá"), assistantText("Vou ajudar"), assistantText("Pronto")],
    });
    const result = await mock.run({ prompt: "olá" });
    expect(result.msgsConsumed).toBe(3);
    expect(result.finalText).toContain("Olá");
    expect(result.finalText).toContain("Pronto");
    expect(result.stopReason).toBe("completed");
    expect(result.error).toBeNull();
  });

  test("totalTurns conta blocos contínuos de assistant", async () => {
    const mock = new MockAgentClient({
      messages: [assistantText("turn1"), toolResult("tu1", "result"), assistantText("turn2")],
    });
    const result = await mock.run({ prompt: "x" });
    expect(result.totalTurns).toBe(2);
  });

  test("erro no stream resulta em stopReason=error", async () => {
    const mock = new MockAgentClient({
      messages: [assistantText("partial")],
      throwAfter: new Error("network down"),
    });
    const result = await mock.run({ prompt: "x" });
    expect(result.stopReason).toBe("error");
    expect(result.error).toBe("network down");
    expect(result.msgsConsumed).toBe(1);
  });

  test("invocations registradas com options recebidas", async () => {
    const mock = new MockAgentClient({ messages: [assistantText("ok")] });
    await mock.run({
      prompt: "test",
      sessionId: "session-uuid",
      maxTurns: 5,
      allowedTools: ["Read", "Edit"],
    });
    expect(mock.invocations).toHaveLength(1);
    expect(mock.invocations[0]?.maxTurns).toBe(5);
    expect(mock.invocations[0]?.allowedTools).toEqual(["Read", "Edit"]);
  });

  test("multiple enqueueResponse permite múltiplas calls", async () => {
    const mock = new MockAgentClient();
    mock.enqueueResponse({ messages: [assistantText("1")] });
    mock.enqueueResponse({ messages: [assistantText("2")] });

    const a = await mock.run({ prompt: "x" });
    const b = await mock.run({ prompt: "y" });
    expect(a.finalText).toBe("1");
    expect(b.finalText).toBe("2");
  });

  test("sem response enqueued resulta em stopReason=error", async () => {
    // collectRun captura erro do stream (não propaga) — design intencional
    // pra worker não crashar; result.error contém a mensagem.
    const mock = new MockAgentClient();
    const result = await mock.run({ prompt: "x" });
    expect(result.stopReason).toBe("error");
    expect(result.error).toContain("no response enqueued");
  });

  test("collectRun direto agrega tool_use sem ser texto", async () => {
    const mock = new MockAgentClient({
      messages: [
        assistantToolUse("Bash", { command: "ls" }, "tu_1"),
        toolResult("tu_1", "file.txt\n"),
        assistantText("listei"),
      ],
    });
    const result = await collectRun(mock.stream({ prompt: "list" }));
    expect(result.msgsConsumed).toBe(3);
    expect(result.finalText).toBe("listei");
  });
});
