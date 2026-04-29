import { describe, expect, test } from "bun:test";

describe("smoke", () => {
  test("arithmetic", () => {
    expect(1 + 1).toBe(2);
  });

  test("path alias resolves", async () => {
    const domain = await import("@clawde/domain");
    expect(domain).toBeDefined();
  });
});
