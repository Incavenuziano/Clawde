/**
 * T-115: integration test pra `clawde reflect`.
 *
 * Setup com events + observations fictícios em janela. Mock do fetch ao
 * receiver. Valida que:
 *   - 1 task com agent="reflector" foi enfileirada (POST /enqueue)
 *   - prompt contém marcadores `events_window` e `observations_window`
 *   - prompt contém os events/observations da janela
 *   - dedupKey segue padrão `reflect:YYYY-MM-DDTHH`
 *   - priority=LOW
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReflect } from "@clawde/cli/commands/reflect";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { MemoryRepo } from "@clawde/db/repositories/memory";

interface CapturedRequest {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function makeFakeFetch(): {
  fetchFn: typeof fetch;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    captured.push({ url, method: init?.method ?? "GET", body });
    return new Response(JSON.stringify({ taskId: 42, traceId: "01HX-TEST", deduped: false }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, captured };
}

describe("clawde reflect (T-112..T-115)", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "clawde-reflect-"));
    dbPath = join(dbDir, "state.db");
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);
  });

  afterEach(() => {
    rmSync(dbDir, { recursive: true, force: true });
  });

  test("enfileira task reflector com prompt estruturado e dedup horário", async () => {
    // Pré-popula events + observations dentro da janela (last 24h).
    const setupDb = openDb(dbPath);
    const events = new EventsRepo(setupDb);
    const memory = new MemoryRepo(setupDb);

    events.insert({
      taskRunId: null,
      sessionId: null,
      traceId: "trace-A",
      spanId: null,
      kind: "enqueue",
      payload: { task_id: 1, priority: "NORMAL" },
    });
    events.insert({
      taskRunId: null,
      sessionId: null,
      traceId: "trace-A",
      spanId: null,
      kind: "task_finish",
      payload: { task_id: 1, msgs: 5 },
    });
    memory.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "task de teste finalizou em 5 mensagens",
      importance: 0.4,
      consolidatedInto: null,
    });
    closeDb(setupDb);

    const { fetchFn, captured } = makeFakeFetch();
    const exitCode = await runReflect({
      since: "24h",
      receiverUrl: "http://localhost:18790",
      dbPath,
      format: "text",
      fetchFn,
      // Fixa "agora" pra dedup determinístico no teste.
      nowMs: Date.parse("2026-04-30T15:30:00Z"),
    });

    expect(exitCode).toBe(0);
    expect(captured).toHaveLength(1);
    const req = captured[0];
    if (req === undefined) throw new Error("missing request");
    expect(req.url).toBe("http://localhost:18790/enqueue");
    expect(req.method).toBe("POST");
    expect(req.body.priority).toBe("LOW");
    expect(req.body.agent).toBe("reflector");
    expect(req.body.dedupKey).toBe("reflect:2026-04-30T15");
    const prompt = String(req.body.prompt);
    expect(prompt).toContain("events_window");
    expect(prompt).toContain("observations_window");
    expect(prompt).toContain("trace-A");
    expect(prompt).toContain("task de teste finalizou");
    expect(prompt).toContain("events_count: 2");
    expect(prompt).toContain("observations_count: 1");
  });

  test("janela vazia ainda enfileira reflection (com counts=0)", async () => {
    const { fetchFn, captured } = makeFakeFetch();
    const exitCode = await runReflect({
      since: "24h",
      receiverUrl: "http://localhost:18790",
      dbPath,
      format: "text",
      fetchFn,
      nowMs: Date.parse("2026-04-30T15:30:00Z"),
    });

    expect(exitCode).toBe(0);
    expect(captured).toHaveLength(1);
    const prompt = String(captured[0]?.body.prompt ?? "");
    expect(prompt).toContain("events_count: 0");
    expect(prompt).toContain("observations_count: 0");
    expect(prompt).toContain("(no events in window)");
    expect(prompt).toContain("(no observations in window)");
  });

  test("--since inválido falha com exit 1", async () => {
    const { fetchFn, captured } = makeFakeFetch();
    const exitCode = await runReflect({
      since: "wat",
      receiverUrl: "http://localhost:18790",
      dbPath,
      format: "text",
      fetchFn,
    });
    expect(exitCode).toBe(1);
    expect(captured).toHaveLength(0);
  });

  test("dedup do receiver (409) é tratado como sucesso", async () => {
    const captured: CapturedRequest[] = [];
    const fetchFn = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      captured.push({ url, method: init?.method ?? "GET", body });
      return new Response(JSON.stringify({ taskId: 99, traceId: "01HX-DUP", deduped: true }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const exitCode = await runReflect({
      since: "24h",
      receiverUrl: "http://localhost:18790",
      dbPath,
      format: "text",
      fetchFn,
      nowMs: Date.parse("2026-04-30T15:30:00Z"),
    });
    expect(exitCode).toBe(0);
    expect(captured).toHaveLength(1);
  });
});
