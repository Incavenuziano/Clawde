import { describe, expect, test } from "bun:test";
import { parseDryRun, parseMaxTasks } from "@clawde/worker/main";

describe("worker/main parseMaxTasks", () => {
  test("default 50 quando flag ausente", () => {
    expect(parseMaxTasks([])).toBe(50);
    expect(parseMaxTasks(["--other", "foo"])).toBe(50);
  });

  test("respeita valor de --max-tasks", () => {
    expect(parseMaxTasks(["--max-tasks", "10"])).toBe(10);
    expect(parseMaxTasks(["--max-tasks", "200"])).toBe(200);
  });

  test("ignora valor não-numérico ou ≤ 0", () => {
    expect(parseMaxTasks(["--max-tasks", "abc"])).toBe(50);
    expect(parseMaxTasks(["--max-tasks", "0"])).toBe(50);
    expect(parseMaxTasks(["--max-tasks", "-5"])).toBe(50);
  });

  test("ignora flag sem valor", () => {
    expect(parseMaxTasks(["--max-tasks"])).toBe(50);
  });

  test("respeita fallback custom", () => {
    expect(parseMaxTasks([], 25)).toBe(25);
    expect(parseMaxTasks(["--max-tasks", "abc"], 25)).toBe(25);
  });

  test("parseDryRun detecta --dry-run", () => {
    expect(parseDryRun([])).toBe(false);
    expect(parseDryRun(["--max-tasks", "5"])).toBe(false);
    expect(parseDryRun(["--dry-run"])).toBe(true);
    expect(parseDryRun(["--foo", "1", "--dry-run"])).toBe(true);
  });
});
