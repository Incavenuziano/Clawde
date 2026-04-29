import { describe, expect, test } from "bun:test";
import {
  SESSION_STATE_VALUES,
  SESSION_TRANSITIONS,
  type Session,
  type SessionState,
  deriveSessionId,
} from "@clawde/domain/session";
import { CLAWDE_UUID_NAMESPACE, uuidV5 } from "@clawde/domain/uuid";

describe("domain/session SESSION_STATE_VALUES", () => {
  test("has 6 states in canonical order", () => {
    expect(SESSION_STATE_VALUES).toEqual([
      "created",
      "active",
      "idle",
      "stale",
      "compact_pending",
      "archived",
    ]);
  });
});

describe("domain/session SESSION_TRANSITIONS", () => {
  test("every state has a transitions entry", () => {
    for (const state of SESSION_STATE_VALUES) {
      expect(SESSION_TRANSITIONS[state]).toBeDefined();
    }
  });

  test("created → active is the only path out of created", () => {
    expect(SESSION_TRANSITIONS.created).toEqual(["active"]);
  });

  test("idle → active reactivates and idle → stale ages", () => {
    expect(SESSION_TRANSITIONS.idle).toContain("active");
    expect(SESSION_TRANSITIONS.idle).toContain("stale");
  });

  test("compact_pending can go back to active or be archived", () => {
    expect(SESSION_TRANSITIONS.compact_pending).toContain("active");
    expect(SESSION_TRANSITIONS.compact_pending).toContain("archived");
  });

  test("archived is terminal", () => {
    expect(SESSION_TRANSITIONS.archived).toEqual([]);
  });
});

describe("domain/uuid UUID v5", () => {
  test("namespace is a valid UUID format", () => {
    expect(CLAWDE_UUID_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("uuidV5 produces version-5 UUID (high nibble of byte 6 == 5)", () => {
    const id = uuidV5("test");
    // bytes 12-15 are byte 6 in UUID hex (after 2 dashes + 8+4 = 14 chars; first nibble of byte 6 is at position 14)
    const versionNibble = id[14];
    expect(versionNibble).toBe("5");
  });

  test("uuidV5 produces RFC 4122 variant (high bits of byte 8 == 10xx)", () => {
    const id = uuidV5("test");
    // byte 8 is at position 19 in UUID hex (8+1+4+1+4+1 = 19)
    const variantHexChar = id[19] ?? "";
    expect(["8", "9", "a", "b"]).toContain(variantHexChar);
  });

  test("uuidV5 is deterministic (same input → same UUID)", () => {
    expect(uuidV5("hello")).toBe(uuidV5("hello"));
  });

  test("uuidV5 differs for different inputs", () => {
    expect(uuidV5("a")).not.toBe(uuidV5("b"));
  });
});

describe("domain/session deriveSessionId", () => {
  test("same (agent, workingDir) → same UUID", () => {
    const a = deriveSessionId({ agent: "default", workingDir: "/tmp/x" });
    const b = deriveSessionId({ agent: "default", workingDir: "/tmp/x" });
    expect(a).toBe(b);
  });

  test("different agent → different UUID", () => {
    const a = deriveSessionId({ agent: "default", workingDir: "/tmp/x" });
    const b = deriveSessionId({ agent: "implementer", workingDir: "/tmp/x" });
    expect(a).not.toBe(b);
  });

  test("different workingDir → different UUID", () => {
    const a = deriveSessionId({ agent: "default", workingDir: "/tmp/x" });
    const b = deriveSessionId({ agent: "default", workingDir: "/tmp/y" });
    expect(a).not.toBe(b);
  });

  test("intent suffix changes the UUID", () => {
    const a = deriveSessionId({ agent: "default", workingDir: "/tmp/x" });
    const b = deriveSessionId({
      agent: "default",
      workingDir: "/tmp/x",
      intent: "review-pr-42",
    });
    expect(a).not.toBe(b);
  });

  test("returned ID is a valid UUID format", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp/x" });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("domain/session types compile", () => {
  test("Session sample is valid", () => {
    const session: Session = {
      sessionId: deriveSessionId({ agent: "default", workingDir: "/tmp" }),
      agent: "default",
      state: "created" satisfies SessionState,
      lastUsedAt: null,
      msgCount: 0,
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
    };
    expect(session.state).toBe("created");
  });
});
