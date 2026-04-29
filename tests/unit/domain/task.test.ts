import { describe, expect, test } from "bun:test";
import {
  type NewTask,
  PRIORITY_VALUES,
  type Priority,
  TASK_RUN_STATUS_VALUES,
  TASK_RUN_TRANSITIONS,
  TASK_SOURCE_VALUES,
  type TaskRunStatus,
} from "@clawde/domain/task";

describe("domain/task constants", () => {
  test("PRIORITY_VALUES has 4 values in order", () => {
    expect(PRIORITY_VALUES).toEqual(["LOW", "NORMAL", "HIGH", "URGENT"]);
  });

  test("TASK_RUN_STATUS_VALUES has 5 values", () => {
    expect(TASK_RUN_STATUS_VALUES).toEqual([
      "pending",
      "running",
      "succeeded",
      "failed",
      "abandoned",
    ]);
  });

  test("TASK_SOURCE_VALUES enumerates all sources from BLUEPRINT §2.1", () => {
    expect(TASK_SOURCE_VALUES).toContain("cli");
    expect(TASK_SOURCE_VALUES).toContain("telegram");
    expect(TASK_SOURCE_VALUES).toContain("webhook-github");
    expect(TASK_SOURCE_VALUES).toContain("subagent");
  });
});

describe("domain/task TASK_RUN_TRANSITIONS", () => {
  test("every status has a transition entry", () => {
    for (const status of TASK_RUN_STATUS_VALUES) {
      expect(TASK_RUN_TRANSITIONS[status]).toBeDefined();
    }
  });

  test("succeeded and failed are terminal (no outgoing transitions)", () => {
    expect(TASK_RUN_TRANSITIONS.succeeded).toEqual([]);
    expect(TASK_RUN_TRANSITIONS.failed).toEqual([]);
  });

  test("pending → running and pending → abandoned are valid", () => {
    expect(TASK_RUN_TRANSITIONS.pending).toContain("running");
    expect(TASK_RUN_TRANSITIONS.pending).toContain("abandoned");
  });

  test("running → succeeded, failed, abandoned are valid", () => {
    expect(TASK_RUN_TRANSITIONS.running).toContain("succeeded");
    expect(TASK_RUN_TRANSITIONS.running).toContain("failed");
    expect(TASK_RUN_TRANSITIONS.running).toContain("abandoned");
  });

  test("abandoned → pending allows retry", () => {
    expect(TASK_RUN_TRANSITIONS.abandoned).toContain("pending");
  });

  test("invalid transitions are not present", () => {
    expect(TASK_RUN_TRANSITIONS.pending).not.toContain("succeeded");
    expect(TASK_RUN_TRANSITIONS.pending).not.toContain("failed");
    expect(TASK_RUN_TRANSITIONS.running).not.toContain("pending");
    expect(TASK_RUN_TRANSITIONS.succeeded).not.toContain("pending");
  });
});

describe("domain/task types compile", () => {
  test("NewTask sample is valid", () => {
    const sample: NewTask = {
      priority: "NORMAL" satisfies Priority,
      prompt: "test",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    };
    expect(sample.prompt).toBe("test");
  });

  test("TaskRunStatus type is restricted to enum values", () => {
    const valid: TaskRunStatus = "running";
    expect(valid).toBe("running");
  });
});
