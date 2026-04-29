import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker } from "@clawde/quota";
import {
  TokenBucketRateLimiter,
  signGitHub,
  verifyGitHubHmac,
  verifyTelegramSecret,
} from "@clawde/receiver";
import { makeEnqueueHandler } from "@clawde/receiver/routes/enqueue";
import { makeHealthHandler } from "@clawde/receiver/routes/health";
import { type ReceiverHandle, createReceiver } from "@clawde/receiver";

interface Setup {
  readonly db: ClawdeDatabase;
  readonly receiver: ReceiverHandle;
  readonly baseUrl: string;
  readonly cleanup: () => void;
}

let portCounter = 28790;
function nextPort(): number {
  return portCounter++;
}

async function startReceiver(): Promise<Setup> {
  const dir = mkdtempSync(join(tmpdir(), "clawde-recv-"));
  const db = openDb(join(dir, "state.db"));
  applyPending(db, defaultMigrationsDir());
  const port = nextPort();
  const tcp = `127.0.0.1:${port}`;

  setLogSink(() => {});
  const logger = createLogger({ component: "test-receiver" });
  const receiver = createReceiver({ listenTcp: tcp, logger });

  const tasksRepo = new TasksRepo(db);
  const eventsRepo = new EventsRepo(db);
  const quotaRepo = new QuotaLedgerRepo(db);
  const tracker = new QuotaTracker(quotaRepo, DEFAULT_TRACKER_CONFIG);
  const rateLimiter = new TokenBucketRateLimiter({ perMinute: 5, perHour: 50 });

  receiver.registerRoute(
    { method: "GET", path: "/health" },
    makeHealthHandler({
      db,
      quotaTracker: tracker,
      receiver,
      version: "0.0.1-test",
    }),
  );
  receiver.registerRoute(
    { method: "POST", path: "/enqueue" },
    makeEnqueueHandler({
      tasksRepo,
      eventsRepo,
      rateLimiter,
      logger,
    }),
  );

  return {
    db,
    receiver,
    baseUrl: `http://${tcp}`,
    cleanup: () => {
      receiver.stop();
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
      resetLogSink();
    },
  };
}

describe("receiver/server + /health", () => {
  let setup: Setup;
  beforeEach(async () => {
    setup = await startReceiver();
  });
  afterEach(() => setup.cleanup());

  test("GET /health retorna 200 ok com schema válido", async () => {
    const res = await fetch(`${setup.baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: string; quota: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
    expect(body.quota).toBe("normal");
    expect(body.version).toBe("0.0.1-test");
  });

  test("rota desconhecida retorna 404", async () => {
    const res = await fetch(`${setup.baseUrl}/missing`);
    expect(res.status).toBe(404);
  });

  test("setDraining(true) → /health retorna 503 reason=draining", async () => {
    setup.receiver.setDraining(true);
    const res = await fetch(`${setup.baseUrl}/health`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("draining");
  });
});

describe("receiver/auth/hmac verifyTelegramSecret", () => {
  test("ok com header igual ao expected", () => {
    expect(verifyTelegramSecret("secret-abc", "secret-abc").ok).toBe(true);
  });
  test("falha com header ausente", () => {
    expect(verifyTelegramSecret(null, "x").ok).toBe(false);
  });
  test("falha com mismatch (constant time)", () => {
    expect(verifyTelegramSecret("wrong", "right123").ok).toBe(false);
  });
});

describe("receiver/auth/hmac verifyGitHubHmac", () => {
  const secret = "github-test-secret";
  const body = JSON.stringify({ action: "opened", number: 42 });

  test("ok com signature válida via signGitHub", () => {
    const sig = signGitHub(body, secret);
    expect(verifyGitHubHmac(sig, body, secret).ok).toBe(true);
  });

  test("falha sem prefixo sha256=", () => {
    expect(verifyGitHubHmac("md5=abcd", body, secret).ok).toBe(false);
  });

  test("falha com body diferente do que assinou", () => {
    const sig = signGitHub(body, secret);
    expect(verifyGitHubHmac(sig, "different body", secret).ok).toBe(false);
  });

  test("falha com secret diferente", () => {
    const sig = signGitHub(body, secret);
    expect(verifyGitHubHmac(sig, body, "wrong-secret").ok).toBe(false);
  });
});

describe("receiver/auth/rate-limit TokenBucketRateLimiter", () => {
  test("permite até perMinute, bloqueia o (perMinute+1)º", () => {
    const rl = new TokenBucketRateLimiter({ perMinute: 3, perHour: 100 });
    const now = 1_000_000;
    expect(rl.check("ip1", now).allow).toBe(true);
    expect(rl.check("ip1", now).allow).toBe(true);
    expect(rl.check("ip1", now).allow).toBe(true);
    const decision = rl.check("ip1", now);
    expect(decision.allow).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("ip diferente tem bucket separado", () => {
    const rl = new TokenBucketRateLimiter({ perMinute: 2, perHour: 100 });
    rl.check("ip1");
    rl.check("ip1");
    expect(rl.check("ip2").allow).toBe(true);
  });

  test("janela rola após 60s", () => {
    const rl = new TokenBucketRateLimiter({ perMinute: 1, perHour: 100 });
    rl.check("ip1", 1_000_000);
    expect(rl.check("ip1", 1_000_000).allow).toBe(false);
    // 60s depois: nova janela.
    expect(rl.check("ip1", 1_000_000 + 60_001).allow).toBe(true);
  });
});

describe("receiver/dedup + /enqueue", () => {
  let setup: Setup;
  beforeEach(async () => {
    setup = await startReceiver();
  });
  afterEach(() => setup.cleanup());

  test("POST /enqueue válido → 202 com taskId+traceId", async () => {
    const res = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test prompt" }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { taskId: number; traceId: string; deduped: boolean };
    expect(body.taskId).toBeGreaterThan(0);
    expect(body.deduped).toBe(false);
    expect(body.traceId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(res.headers.get("X-Clawde-Trace-Id")).toBe(body.traceId);
  });

  test("trace_id do request é ecoado", async () => {
    const trace = "01HXYZTESTTRACE12345678AB";
    const res = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clawde-Trace-Id": trace,
      },
      body: JSON.stringify({ prompt: "x" }),
    });
    const body = (await res.json()) as { traceId: string };
    expect(body.traceId).toBe(trace);
  });

  test("payload inválido (prompt vazio) → 400", async () => {
    const res = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: Array<{ path: string }> };
    expect(body.issues[0]?.path).toBe("prompt");
  });

  test("dedupKey duplicada → 409 com taskId existente", async () => {
    const r1 = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x", dedupKey: "tg-update-42" }),
    });
    const b1 = (await r1.json()) as { taskId: number; deduped: boolean };
    expect(b1.deduped).toBe(false);

    const r2 = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x", dedupKey: "tg-update-42" }),
    });
    expect(r2.status).toBe(409);
    const b2 = (await r2.json()) as { taskId: number; deduped: boolean };
    expect(b2.deduped).toBe(true);
    expect(b2.taskId).toBe(b1.taskId);
  });

  test("X-Idempotency-Key header funciona como alternativa a body.dedupKey", async () => {
    const r1 = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Idempotency-Key": "hk-1" },
      body: JSON.stringify({ prompt: "x" }),
    });
    expect(r1.status).toBe(202);

    const r2 = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Idempotency-Key": "hk-1" },
      body: JSON.stringify({ prompt: "x" }),
    });
    expect(r2.status).toBe(409);
  });

  test("rate limit 429 após perMinute (5 no setup)", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${setup.baseUrl}/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `n${i}` }),
      });
      expect(r.status).toBe(202);
    }
    const blocked = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "blocked" }),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
  });

  test("body não-JSON → 400", async () => {
    const r = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ broken json",
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("invalid JSON");
  });

  test("draining retorna 503 antes de processar /enqueue", async () => {
    setup.receiver.setDraining(true);
    const r = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x" }),
    });
    expect(r.status).toBe(503);
  });
});
