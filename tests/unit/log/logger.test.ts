import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createLogger,
  getMinLevel,
  newSpanId,
  newTraceId,
  redact,
  REDACTED_PLACEHOLDER,
  resetLogSink,
  setLogSink,
  setMinLevel,
  withTrace,
} from "@clawde/log";

describe("log/secrets + redact", () => {
  test("redacts top-level keys (case-insensitive)", () => {
    const out = redact({
      Token: "abc",
      api_key: "xyz",
      Authorization: "Bearer foo",
      normal: "ok",
    }) as Record<string, unknown>;
    expect(out.Token).toBe(REDACTED_PLACEHOLDER);
    expect(out.api_key).toBe(REDACTED_PLACEHOLDER);
    expect(out.Authorization).toBe(REDACTED_PLACEHOLDER);
    expect(out.normal).toBe("ok");
  });

  test("redacts nested keys", () => {
    const out = redact({ inner: { password: "p" } }) as { inner: { password: string } };
    expect(out.inner.password).toBe(REDACTED_PLACEHOLDER);
  });

  test("redacts Anthropic API key by value pattern", () => {
    const out = redact({
      message: "key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
    }) as { message: string };
    expect(out.message).toContain(REDACTED_PLACEHOLDER);
    expect(out.message).not.toContain("sk-ant-api03");
  });

  test("redacts OAuth token by value pattern", () => {
    const out = redact("export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-deadbeef") as string;
    expect(out).toContain(REDACTED_PLACEHOLDER);
    expect(out).not.toContain("sk-ant-oat01-");
  });

  test("redacts arrays of objects", () => {
    const out = redact([{ token: "x" }, { token: "y" }]) as Array<{ token: string }>;
    expect(out[0]?.token).toBe(REDACTED_PLACEHOLDER);
    expect(out[1]?.token).toBe(REDACTED_PLACEHOLDER);
  });

  test("preserves null, undefined, numbers, booleans", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });
});

describe("log/trace", () => {
  test("newTraceId is 26 chars Crockford base32", () => {
    const id = newTraceId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("newTraceId is monotonic by time prefix", async () => {
    const a = newTraceId();
    await new Promise((r) => setTimeout(r, 5));
    const b = newTraceId();
    // First 10 chars (time) should be lex-ordered.
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });

  test("newSpanId is 16 chars", () => {
    expect(newSpanId()).toHaveLength(16);
  });

  test("withTrace propaga via AsyncLocalStorage", () => {
    const traceId = newTraceId();
    const captured: string[] = [];
    const log = createLogger();
    let lines: string[] = [];
    setLogSink((line) => lines.push(line));
    try {
      withTrace({ traceId, spanId: newSpanId() }, () => {
        log.info("inside");
      });
      log.info("outside");
    } finally {
      resetLogSink();
    }
    expect(JSON.parse(lines[0] ?? "{}").trace_id).toBe(traceId);
    expect(JSON.parse(lines[1] ?? "{}").trace_id).toBeUndefined();
    expect(captured).toEqual([]);
  });
});

describe("log/logger", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    setLogSink((line) => lines.push(line));
    setMinLevel("TRACE"); // Ver tudo
  });
  afterEach(() => {
    resetLogSink();
    setMinLevel("INFO");
  });

  test("emite JSON one-line por chamada", () => {
    const log = createLogger({ component: "test" });
    log.info("hello");
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0] ?? "{}");
    expect(obj.level).toBe("INFO");
    expect(obj.msg).toBe("hello");
    expect(obj.component).toBe("test");
    expect(obj.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("redacta payload com tokens", () => {
    const log = createLogger();
    log.info("auth", { token: "sk-ant-xxx" });
    const obj = JSON.parse(lines[0] ?? "{}");
    expect(obj.token).toBe(REDACTED_PLACEHOLDER);
  });

  test("redacta context base também (segredos no createLogger ctx)", () => {
    const log = createLogger({ component: "auth", api_key: "secret" });
    log.info("call");
    const obj = JSON.parse(lines[0] ?? "{}");
    expect(obj.api_key).toBe(REDACTED_PLACEHOLDER);
  });

  test("respeita minLevel: DEBUG suprimido se min=INFO", () => {
    setMinLevel("INFO");
    const log = createLogger();
    log.debug("hidden");
    log.info("shown");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}").msg).toBe("shown");
  });

  test("getMinLevel reflete setMinLevel", () => {
    setMinLevel("WARN");
    expect(getMinLevel()).toBe("WARN");
  });

  test("child herda contexto do parent + extra", () => {
    const parent = createLogger({ component: "p" });
    const child = parent.child({ taskRunId: 7 });
    child.info("nested");
    const obj = JSON.parse(lines[0] ?? "{}");
    expect(obj.component).toBe("p");
    expect(obj.taskRunId).toBe(7);
  });

  test("FATAL emit funciona e tem level=FATAL", () => {
    const log = createLogger();
    log.fatal("boom");
    expect(JSON.parse(lines[0] ?? "{}").level).toBe("FATAL");
  });

  test("erros tipados em payload preservam stack truncated", () => {
    const log = createLogger();
    const err = new Error("test failure");
    log.error("caught", { error: err.message, name: err.name });
    const obj = JSON.parse(lines[0] ?? "{}");
    expect(obj.error).toBe("test failure");
    expect(obj.name).toBe("Error");
  });
});
