import { describe, expect, test } from "bun:test";
import { RealAgentClient, parseRawMessage } from "@clawde/sdk";

const RUN_REAL_SDK =
  process.env.CLAWDE_TEST_REAL_SDK === "1" &&
  process.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined &&
  process.env.CLAUDE_CODE_OAUTH_TOKEN.length > 0;

const maybeTest = RUN_REAL_SDK ? test : test.skip;

async function firstFrom<T>(iterable: AsyncIterable<T>): Promise<T> {
  for await (const item of iterable) {
    return item;
  }
  throw new Error("real-sdk stream returned no messages");
}

describe("integration: real-sdk", () => {
  maybeTest("real-sdk ping returns assistant output", async () => {
    const client = new RealAgentClient();
    const result = await client.run({
      prompt: "Reply with exactly: pong",
      maxTurns: 1,
    });

    expect(result.stopReason).not.toBe("error");
    expect(result.error).toBeNull();
    expect(result.msgsConsumed).toBeGreaterThan(0);
    expect(result.finalText.toLowerCase()).toContain("pong");
  });

  maybeTest("real-sdk parser handles current message shape", async () => {
    const client = new RealAgentClient();
    const first = await firstFrom(
      client.stream({
        prompt: "Reply with exactly: pong",
        maxTurns: 1,
      }),
    );

    expect(first.raw).toBeDefined();
    const parsedAgain = parseRawMessage(first.raw);
    expect(parsedAgain).not.toBeNull();
    expect(parsedAgain?.role).toBe(first.role);
  });
});
