import { describe, expect, test } from "bun:test";
import { classifyCommand, isGateExpired } from "@clawde/war-room";

describe("war-room gates", () => {
  test("classifica comandos seguros, amarelos, guarded e bloqueados", () => {
    expect(classifyCommand(["git", "status", "--short"])).toBe("green");
    expect(classifyCommand(["bun", "test"])).toBe("yellow");
    expect(classifyCommand(["clawde", "events", "purge", "--confirm"])).toBe("guarded");
    expect(classifyCommand(["git", "reset", "--hard"])).toBe("blocked");
  });

  test("expiração de gate respeita data", () => {
    expect(isGateExpired("2026-01-01T00:00:00Z", new Date("2026-01-02T00:00:00Z"))).toBe(true);
    expect(isGateExpired("2026-01-03T00:00:00Z", new Date("2026-01-02T00:00:00Z"))).toBe(false);
  });
});
