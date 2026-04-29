import { describe, expect, test } from "bun:test";
import { EVENT_KIND_VALUES, type Event, type EventKind, type NewEvent } from "@clawde/domain/event";

describe("domain/event EVENT_KIND_VALUES", () => {
  test("contains receiver kinds", () => {
    expect(EVENT_KIND_VALUES).toContain("enqueue");
    expect(EVENT_KIND_VALUES).toContain("auth_fail");
    expect(EVENT_KIND_VALUES).toContain("rate_limit_hit");
    expect(EVENT_KIND_VALUES).toContain("dedup_skip");
  });

  test("contains worker lifecycle kinds", () => {
    expect(EVENT_KIND_VALUES).toContain("task_start");
    expect(EVENT_KIND_VALUES).toContain("task_finish");
    expect(EVENT_KIND_VALUES).toContain("lease_expired");
  });

  test("contains claude SDK kinds", () => {
    expect(EVENT_KIND_VALUES).toContain("claude_invocation_start");
    expect(EVENT_KIND_VALUES).toContain("tool_use");
    expect(EVENT_KIND_VALUES).toContain("tool_blocked");
  });

  test("contains quota kinds", () => {
    expect(EVENT_KIND_VALUES).toContain("quota_threshold_crossed");
    expect(EVENT_KIND_VALUES).toContain("quota_reset");
  });

  test("contains auth kinds", () => {
    expect(EVENT_KIND_VALUES).toContain("oauth_refresh_attempt");
    expect(EVENT_KIND_VALUES).toContain("oauth_expiry_warning");
  });

  test("contains sandbox kinds", () => {
    expect(EVENT_KIND_VALUES).toContain("sandbox_init");
    expect(EVENT_KIND_VALUES).toContain("sandbox_violation");
  });

  test("contains learning kinds (ADR 0009)", () => {
    expect(EVENT_KIND_VALUES).toContain("lesson");
    expect(EVENT_KIND_VALUES).toContain("reflection_start");
    expect(EVENT_KIND_VALUES).toContain("reflection_end");
  });

  test("contains hook kinds (BLUEPRINT §4.5)", () => {
    expect(EVENT_KIND_VALUES).toContain("hook_error");
    expect(EVENT_KIND_VALUES).toContain("hook_timeout");
  });

  test("all kinds are unique", () => {
    const set = new Set(EVENT_KIND_VALUES);
    expect(set.size).toBe(EVENT_KIND_VALUES.length);
  });
});

describe("domain/event types compile", () => {
  test("NewEvent sample is valid", () => {
    const e: NewEvent = {
      taskRunId: 42,
      sessionId: null,
      traceId: "01HXYZ",
      spanId: null,
      kind: "task_start" satisfies EventKind,
      payload: { prompt_length: 120 },
    };
    expect(e.kind).toBe("task_start");
  });

  test("Event includes id and ts", () => {
    const e: Event = {
      id: 1,
      ts: new Date().toISOString(),
      taskRunId: null,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "enqueue",
      payload: {},
    };
    expect(e.id).toBe(1);
  });
});
