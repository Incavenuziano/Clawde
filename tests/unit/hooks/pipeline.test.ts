import { describe, expect, test } from "bun:test";
import {
  type HookHandler,
  type HookInput,
  type HookOutput,
  HookPipeline,
  type PreToolUsePayload,
  type SessionStartPayload,
  type UserPromptSubmitPayload,
  makePreToolUseHandler,
  makeSessionStartHandler,
  makeUserPromptSubmitHandler,
} from "@clawde/hooks";

const COMMON = {
  sessionId: "sess-1",
  taskRunId: 42,
  traceId: "trace-1",
  ts: "2026-04-29T10:00:00.000Z",
};

function sessionStartInput(payload: SessionStartPayload): HookInput {
  return { hook: "SessionStart", payload, ...COMMON };
}

function userPromptInput(payload: UserPromptSubmitPayload): HookInput {
  return { hook: "UserPromptSubmit", payload, ...COMMON };
}

function preToolInput(payload: PreToolUsePayload): HookInput {
  return { hook: "PreToolUse", payload, ...COMMON };
}

describe("hooks/pipeline run sem handler registrado", () => {
  test("retorna {ok:true} (no-op)", async () => {
    const pipe = new HookPipeline();
    const result = await pipe.run(sessionStartInput({ agent: "default", workingDir: "/tmp" }));
    expect(result.ok).toBe(true);
  });
});

describe("hooks/pipeline handler básico", () => {
  test("handler síncrono chamado", async () => {
    const pipe = new HookPipeline();
    let captured: HookInput | null = null;
    pipe.register("SessionStart", (input: HookInput): HookOutput => {
      captured = input;
      return { ok: true, message: "started" };
    });
    const result = await pipe.run(sessionStartInput({ agent: "implementer", workingDir: "/tmp" }));
    expect(result.message).toBe("started");
    expect(captured).not.toBeNull();
  });

  test("handler async retorna output", async () => {
    const pipe = new HookPipeline();
    pipe.register("PreToolUse", async (): Promise<HookOutput> => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: false, block: true, message: "tool blocked" };
    });
    const result = await pipe.run(
      preToolInput({ toolName: "Bash", toolInput: { command: "rm -rf /" } }),
    );
    expect(result.block).toBe(true);
  });
});

describe("hooks/pipeline timeout", () => {
  test("UserPromptSubmit timeout default=block (fail-safe)", async () => {
    const pipe = new HookPipeline();
    pipe.register("UserPromptSubmit", (async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { ok: true };
    }) as HookHandler<HookInput>);
    // Override timeout pra 5ms para forçar timeout rápido.
    const pipe2 = new HookPipeline({
      UserPromptSubmit: { enabled: true, timeoutMs: 5, onTimeout: "block" },
    });
    pipe2.register("UserPromptSubmit", (async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { ok: true };
    }) as HookHandler<HookInput>);

    const result = await pipe2.run(userPromptInput({ prompt: "x" }));
    expect(result.ok).toBe(false);
    expect(result.block).toBe(true);
    expect(result.message).toContain("timeout");
  });

  test("PreToolUse timeout default=allow", async () => {
    const pipe = new HookPipeline({
      PreToolUse: { enabled: true, timeoutMs: 5, onTimeout: "allow" },
    });
    pipe.register("PreToolUse", (async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { ok: true };
    }) as HookHandler<HookInput>);

    const result = await pipe.run(preToolInput({ toolName: "Read", toolInput: {} }));
    expect(result.ok).toBe(false);
    expect(result.block).toBe(false);
  });
});

describe("hooks/pipeline error handling", () => {
  test("handler que lança vira output ok=false sem block", async () => {
    const pipe = new HookPipeline();
    pipe.register("SessionStart", () => {
      throw new Error("boom");
    });
    const result = await pipe.run(sessionStartInput({ agent: "x", workingDir: "/tmp" }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("boom");
    expect(result.block).toBe(false);
  });
});

describe("hooks/pipeline disabled", () => {
  test("hook disabled retorna {ok:true} sem chamar handler", async () => {
    const pipe = new HookPipeline({
      SessionStart: { enabled: false, timeoutMs: 1000, onTimeout: "allow" },
    });
    let called = false;
    pipe.register("SessionStart", () => {
      called = true;
      return { ok: false };
    });
    const result = await pipe.run(sessionStartInput({ agent: "x", workingDir: "/tmp" }));
    expect(called).toBe(false);
    expect(result.ok).toBe(true);
  });
});

describe("hooks/handlers default emitem eventos via callback", () => {
  test("makeSessionStartHandler chama emit", async () => {
    const events: Array<{ kind: string; payload: unknown }> = [];
    const handler = makeSessionStartHandler((kind, payload) => events.push({ kind, payload }));
    await handler(
      sessionStartInput({ agent: "x", workingDir: "/tmp" }) as HookInput & {
        hook: "SessionStart";
        payload: SessionStartPayload;
      },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("session_start_hook");
  });

  test("makeUserPromptSubmitHandler emite com prompt_len", async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const handler = makeUserPromptSubmitHandler((kind, payload) => events.push({ kind, payload }));
    await handler(
      userPromptInput({ prompt: "hello world", source: "cli" }) as HookInput & {
        hook: "UserPromptSubmit";
        payload: UserPromptSubmitPayload;
      },
    );
    expect(events[0]?.payload.prompt_len).toBe(11);
    expect(events[0]?.payload.source).toBe("cli");
  });

  test("makePreToolUseHandler captura toolName + input", async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const handler = makePreToolUseHandler((kind, payload) => events.push({ kind, payload }));
    await handler(
      preToolInput({ toolName: "Bash", toolInput: { command: "ls" } }) as HookInput & {
        hook: "PreToolUse";
        payload: PreToolUsePayload;
      },
    );
    expect(events[0]?.kind).toBe("tool_use");
    expect(events[0]?.payload.tool).toBe("Bash");
  });

  test("makePreToolUseHandler bloqueia tool fora de allowedTools", async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const handler = makePreToolUseHandler((kind, payload) => events.push({ kind, payload }), {
      allowedTools: ["Read"],
      sandbox: { level: 3, allowed_writes: ["./workspace"] },
    });
    const out = await handler(
      preToolInput({ toolName: "Bash", toolInput: { command: "ls" } }) as HookInput & {
        hook: "PreToolUse";
        payload: PreToolUsePayload;
      },
    );
    expect(out.ok).toBe(false);
    expect(out.block).toBe(true);
    expect(events[0]?.kind).toBe("tool_blocked");
    expect(events[0]?.payload.reason).toBe("tool_not_allowlisted");
  });

  test("makePreToolUseHandler bloqueia Bash em sandbox nível >=2", async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const handler = makePreToolUseHandler((kind, payload) => events.push({ kind, payload }), {
      allowedTools: ["Bash", "Read"],
      sandbox: { level: 3, allowed_writes: ["./workspace"] },
    });
    const out = await handler(
      preToolInput({ toolName: "Bash", toolInput: { command: "pwd" } }) as HookInput & {
        hook: "PreToolUse";
        payload: PreToolUsePayload;
      },
    );
    expect(out.ok).toBe(false);
    expect(out.block).toBe(true);
    expect(events[0]?.kind).toBe("tool_blocked");
    expect(events[0]?.payload.reason).toBe("bash_requires_subprocess_wrapper");
  });

  test("makePreToolUseHandler bloqueia Edit fora de allowed_writes", async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const handler = makePreToolUseHandler((kind, payload) => events.push({ kind, payload }), {
      allowedTools: ["Edit", "Read"],
      sandbox: { level: 2, allowed_writes: ["./workspace"] },
    });
    const out = await handler(
      preToolInput({ toolName: "Edit", toolInput: { path: "/etc/passwd" } }) as HookInput & {
        hook: "PreToolUse";
        payload: PreToolUsePayload;
      },
    );
    expect(out.ok).toBe(false);
    expect(out.block).toBe(true);
    expect(events[0]?.kind).toBe("tool_blocked");
    expect(events[0]?.payload.reason).toBe("write_path_not_allowed");
  });
});
