/**
 * End-to-end lifecycle: HTTP receiver → INSERT em tasks → worker processa →
 * task_run.status=succeeded → events.task_finish.
 *
 * Sem SDK real (mock client), mas exercita TUDO em volta: bind de porta,
 * fetch HTTP do test pra receiver, dedup, INSERT real no SQLite, worker
 * picks up, lease, quota ledger, eventos audit. É o que mais perto temos
 * de "instalei e roda" sem precisar do CLI Anthropic real.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import {
  NoopWorkerTrigger,
  type ReceiverHandle,
  TokenBucketRateLimiter,
  createReceiver,
  makeEnqueueHandler,
} from "@clawde/receiver";
import { LeaseManager, type RunnerDeps, processNextPending } from "@clawde/worker";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

let portCounter = 39100;
function nextPort(): number {
  return portCounter++;
}

interface E2E {
  readonly db: ClawdeDatabase;
  readonly baseUrl: string;
  readonly receiver: ReceiverHandle;
  readonly mockClient: MockAgentClient;
  readonly runnerDeps: RunnerDeps;
  readonly cleanup: () => void;
}

async function setup(): Promise<E2E> {
  const dir = mkdtempSync(join(tmpdir(), "clawde-e2e-"));
  const db = openDb(join(dir, "state.db"));
  applyPending(db, defaultMigrationsDir());
  setLogSink(() => {});
  const logger = createLogger({ component: "e2e" });

  const tasksRepo = new TasksRepo(db);
  const runsRepo = new TaskRunsRepo(db);
  const eventsRepo = new EventsRepo(db);
  const quotaRepo = new QuotaLedgerRepo(db);
  const lease = new LeaseManager(runsRepo, eventsRepo, {
    leaseSeconds: 60,
    heartbeatSeconds: 999,
  });
  const tracker = new QuotaTracker(quotaRepo, DEFAULT_TRACKER_CONFIG);
  const rateLimiter = new TokenBucketRateLimiter({ perMinute: 60, perHour: 600 });

  const port = nextPort();
  const tcp = `127.0.0.1:${port}`;
  const receiver = createReceiver({ listenTcp: tcp, logger });
  receiver.registerRoute(
    { method: "POST", path: "/enqueue" },
    makeEnqueueHandler({
      tasksRepo,
      eventsRepo,
      rateLimiter,
      logger,
      workerTrigger: new NoopWorkerTrigger(),
    }),
  );

  const mockClient = new MockAgentClient();
  const runnerDeps: RunnerDeps = {
    tasksRepo,
    runsRepo,
    eventsRepo,
    leaseManager: lease,
    quotaTracker: tracker,
    quotaPolicy: makeQuotaPolicy(),
    agentClient: mockClient,
    logger,
    workerId: "e2e-worker",
  };

  return {
    db,
    baseUrl: `http://${tcp}`,
    receiver,
    mockClient,
    runnerDeps,
    cleanup: () => {
      receiver.stop();
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
      resetLogSink();
    },
  };
}

describe("e2e: receiver → DB → worker → done", () => {
  let env: E2E;
  beforeEach(async () => {
    env = await setup();
  });
  afterEach(() => env.cleanup());

  test("happy path: POST /enqueue, worker pega, task_run vira succeeded", async () => {
    // 1. Cliente faz POST.
    const resp = await fetch(`${env.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "explica o repo",
        priority: "NORMAL",
        agent: "default",
      }),
    });
    expect(resp.status).toBe(202);
    const body = (await resp.json()) as { taskId: number; traceId: string };
    expect(body.taskId).toBeGreaterThan(0);
    expect(typeof body.traceId).toBe("string");

    // 2. Worker pega a task.
    env.mockClient.enqueueResponse({
      messages: [assistantText("Ok, esse repo é..."), assistantText("Done.")],
    });
    const result = await processNextPending(env.runnerDeps);
    expect(result).not.toBeNull();
    expect(result?.task.id).toBe(body.taskId);
    expect(result?.run.status).toBe("succeeded");
    expect(result?.run.msgsConsumed).toBe(2);

    // 3. Audit events estão lá.
    const events = env.runnerDeps.eventsRepo.queryByTaskRun(result?.run.id ?? -1);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("task_start");
    expect(kinds).toContain("claude_invocation_start");
    expect(kinds).toContain("claude_invocation_end");
    expect(kinds).toContain("task_finish");

    // 4. Quota ledger refletiu.
    const window = env.runnerDeps.quotaTracker.currentWindow();
    expect(window.msgsConsumed).toBe(2);
  });

  test("dedup_key: POST duplicado retorna 409, worker processa só 1", async () => {
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "task única",
        priority: "NORMAL",
        agent: "default",
        dedupKey: "test-dedup-1",
      }),
    };
    const r1 = await fetch(`${env.baseUrl}/enqueue`, opts);
    expect(r1.status).toBe(202);
    const r2 = await fetch(`${env.baseUrl}/enqueue`, opts);
    expect(r2.status).toBe(409);

    env.mockClient.enqueueResponse({ messages: [assistantText("done")] });
    const first = await processNextPending(env.runnerDeps);
    expect(first).not.toBeNull();
    const second = await processNextPending(env.runnerDeps);
    expect(second).toBeNull();
  });

  test("falha do agentClient propaga como task_run.failed", async () => {
    const r = await fetch(`${env.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "p", priority: "NORMAL", agent: "default" }),
    });
    expect(r.status).toBe(202);

    env.mockClient.enqueueResponse({
      messages: [assistantText("partial")],
      throwAfter: new Error("simulated 500 from API"),
    });
    const result = await processNextPending(env.runnerDeps);
    expect(result?.run.status).toBe("failed");
    expect(result?.run.error).toContain("simulated 500");
  });

  test("trace_id propagado de POST → events do task_run", async () => {
    const traceId = "01HARDCODEDULID000000000000";
    const resp = await fetch(`${env.baseUrl}/enqueue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clawde-Trace-Id": traceId,
      },
      body: JSON.stringify({ prompt: "p", priority: "NORMAL", agent: "default" }),
    });
    const body = (await resp.json()) as { taskId: number; traceId: string };
    expect(body.traceId).toBe(traceId);
    // O trace_id é registrado no event de enqueue (pre-worker).
    const enqueueEvents = env.runnerDeps.eventsRepo.queryByTrace(traceId);
    expect(enqueueEvents.length).toBeGreaterThan(0);
    expect(enqueueEvents[0]?.kind).toBe("enqueue");
  });
});
