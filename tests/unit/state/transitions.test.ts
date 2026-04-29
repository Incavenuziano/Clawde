import { describe, expect, test } from "bun:test";
import {
  InvalidTransitionError,
  canSessionTransition,
  canTaskRunTransition,
  validateSessionTransition,
  validateTaskRunTransition,
} from "@clawde/state";

describe("state/transitions task_run", () => {
  test("pending → running válido", () => {
    expect(() => validateTaskRunTransition("pending", "running")).not.toThrow();
    expect(canTaskRunTransition("pending", "running")).toBe(true);
  });

  test("running → succeeded válido", () => {
    expect(() => validateTaskRunTransition("running", "succeeded")).not.toThrow();
  });

  test("abandoned → pending válido (re-enqueue)", () => {
    expect(() => validateTaskRunTransition("abandoned", "pending")).not.toThrow();
  });

  test("pending → succeeded inválido (não passou por running)", () => {
    expect(() => validateTaskRunTransition("pending", "succeeded")).toThrow(InvalidTransitionError);
    expect(canTaskRunTransition("pending", "succeeded")).toBe(false);
  });

  test("succeeded é terminal: succeeded → qualquer = inválido", () => {
    expect(() => validateTaskRunTransition("succeeded", "running")).toThrow(InvalidTransitionError);
    expect(() => validateTaskRunTransition("succeeded", "pending")).toThrow();
    expect(() => validateTaskRunTransition("succeeded", "failed")).toThrow();
  });

  test("failed é terminal", () => {
    expect(() => validateTaskRunTransition("failed", "running")).toThrow();
  });
});

describe("state/transitions session", () => {
  test("created → active válido", () => {
    expect(() => validateSessionTransition("created", "active")).not.toThrow();
  });

  test("active → idle válido", () => {
    expect(() => validateSessionTransition("active", "idle")).not.toThrow();
  });

  test("idle → active reativa", () => {
    expect(() => validateSessionTransition("idle", "active")).not.toThrow();
  });

  test("idle → stale válido", () => {
    expect(() => validateSessionTransition("idle", "stale")).not.toThrow();
  });

  test("stale → compact_pending válido", () => {
    expect(() => validateSessionTransition("stale", "compact_pending")).not.toThrow();
  });

  test("stale → archived válido", () => {
    expect(() => validateSessionTransition("stale", "archived")).not.toThrow();
  });

  test("compact_pending → active OU archived", () => {
    expect(canSessionTransition("compact_pending", "active")).toBe(true);
    expect(canSessionTransition("compact_pending", "archived")).toBe(true);
  });

  test("archived é terminal", () => {
    expect(() => validateSessionTransition("archived", "active")).toThrow(InvalidTransitionError);
  });

  test("created → idle pula etapa, inválido", () => {
    expect(() => validateSessionTransition("created", "idle")).toThrow();
  });
});

describe("state/transitions InvalidTransitionError", () => {
  test("carrega entity, from, to e mensagem clara", () => {
    try {
      validateTaskRunTransition("succeeded", "running");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.entity).toBe("task_run");
      expect(err.from).toBe("succeeded");
      expect(err.to).toBe("running");
      expect(err.message).toContain("succeeded → running");
    }
  });
});
