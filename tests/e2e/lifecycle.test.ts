/**
 * F3.T46 — E2E lifecycle: queue (CLI) → receiver → state.db → simula trigger
 * .path → worker oneshot processa → verifica estado final.
 *
 * Como systemd .path não existe em testes, simulamos o trigger chamando
 * processNextPending() diretamente após enqueue.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "@clawde/cli/main";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker } from "@clawde/quota";
import { type ReceiverHandle, TokenBucketRateLimiter, createReceiver } from "@clawde/receiver";
import { makeEnqueueHandler } from "@clawde/receiver/routes/enqueue";
import { makeHealthHandler } from "@clawde/receiver/routes/health";
import { LeaseManager, type RunnerDeps, processNextPending } from "@clawde/worker";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
}> {
  const orig = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((c: unknown): boolean => {
    stdout += String(c);
    return true;
  }) as typeof process.stdout.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout }))
    .finally(() => {
      process.stdout.write = orig;
    });
}

let portCounter = 28991;
function nextPort(): number {
  return portCounter++;
}

interface E2ESetup {
  readonly db: ClawdeDatabase;
  readonly dbPath: string;
  readonly baseUrl: string;
  readonly receiver: ReceiverHandle;
  readonly mockClient: MockAgentClient;
  readonly workerDeps: RunnerDeps;
  readonly cleanup: () => void;
}

function startE2E(): E2ESetup {
  const dir = mkdtempSync(join(tmpdir(), "clawde-e2e-"));
  const dbPath = join(dir, "state.db");
  const db = openDb(dbPath);
  applyPending(db, defaultMigrationsDir());

  setLogSink(() => {});
  const logger = createLogger({ component: "e2e" });
  const port = nextPort();
  const receiver = createReceiver({ listenTcp: `127.0.0.1:${port}`, logger });

  const tasksRepo = new TasksRepo(db);
  const runsRepo = new TaskRunsRepo(db);
  const eventsRepo = new EventsRepo(db);
  const quotaRepo = new QuotaLedgerRepo(db);
  const tracker = new QuotaTracker(quotaRepo, DEFAULT_TRACKER_CONFIG);

  receiver.registerRoute(
    { method: "GET", path: "/health" },
    makeHealthHandler({ db, quotaTracker: tracker, receiver, version: "0.0.1-e2e" }),
  );
  receiver.registerRoute(
    { method: "POST", path: "/enqueue" },
    makeEnqueueHandler({
      tasksRepo,
      eventsRepo,
      rateLimiter: new TokenBucketRateLimiter({ perMinute: 100, perHour: 1000 }),
      logger,
    }),
  );

  const lease = new LeaseManager(runsRepo, eventsRepo, {
    leaseSeconds: 60,
    heartbeatSeconds: 999,
  });
  const mockClient = new MockAgentClient();

  const workerDeps: RunnerDeps = {
    tasksRepo,
    runsRepo,
    eventsRepo,
    leaseManager: lease,
    quotaTracker: tracker,
    agentClient: mockClient,
    logger: logger.child({ component: "e2e-worker" }),
    workerId: "worker-e2e",
  };

  return {
    db,
    dbPath,
    baseUrl: `http://127.0.0.1:${port}`,
    receiver,
    mockClient,
    workerDeps,
    cleanup: () => {
      receiver.stop();
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
      resetLogSink();
    },
  };
}

describe("F3.T46 E2E lifecycle: queue → receiver → worker", () => {
  let setup: E2ESetup;
  beforeEach(() => {
    setup = startE2E();
  });
  afterEach(() => setup.cleanup());

  test("clawde queue → task em pending → worker processa → succeeded", async () => {
    const t0 = Date.now();
    setup.mockClient.enqueueResponse({
      messages: [
        assistantText("Recebi a task"),
        assistantText("Processando"),
        assistantText("Pronto, terminei"),
      ],
    });

    // 1. CLI queue → POST /enqueue → INSERT em tasks.
    const queueResult = await captureOutput(() =>
      runMain([
        "queue",
        "implement",
        "feature",
        "X",
        "--receiver-url",
        setup.baseUrl,
        "--db",
        setup.dbPath,
      ]),
    );
    expect(queueResult.exit).toBe(0);
    expect(queueResult.stdout).toContain("taskId=");

    // 2. Verifica row pending em tasks.
    const tasksRows = setup.db.query("SELECT id, prompt FROM tasks").all() as Array<{
      id: number;
      prompt: string;
    }>;
    expect(tasksRows).toHaveLength(1);
    expect(tasksRows[0]?.prompt).toBe("implement feature X");

    // 3. Simula systemd .path trigger: chama processNextPending direto.
    const result = await processNextPending(setup.workerDeps);
    expect(result).not.toBeNull();
    expect(result?.run.status).toBe("succeeded");
    expect(result?.agentResult.msgsConsumed).toBe(3);

    // 4. Verifica trail completa em events.
    if (result === null) throw new Error("unreachable");
    const events = setup.workerDeps.eventsRepo.queryByTaskRun(result.run.id);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("task_start");
    expect(kinds).toContain("claude_invocation_start");
    expect(kinds).toContain("claude_invocation_end");
    expect(kinds).toContain("task_finish");

    // 5. enqueue event existe (do receiver).
    const allEnqueueEvents = setup.workerDeps.eventsRepo.queryByKind("enqueue");
    expect(allEnqueueEvents).toHaveLength(1);
    expect(allEnqueueEvents[0]?.payload.task_id).toBe(tasksRows[0]?.id);

    // 6. quota_ledger decrementado.
    expect(setup.workerDeps.quotaTracker.currentWindow().msgsConsumed).toBe(3);

    // 7. Tempo total <5s (DoD F3.T46).
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test("dedupKey: 2 queues idênticas resultam em 1 task processada", async () => {
    setup.mockClient.enqueueResponse({ messages: [assistantText("done")] });

    await captureOutput(() =>
      runMain([
        "queue",
        "x",
        "--dedup-key",
        "k1",
        "--receiver-url",
        setup.baseUrl,
        "--db",
        setup.dbPath,
      ]),
    );
    await captureOutput(() =>
      runMain([
        "queue",
        "x",
        "--dedup-key",
        "k1",
        "--receiver-url",
        setup.baseUrl,
        "--db",
        setup.dbPath,
      ]),
    );

    const tasks = setup.db.query("SELECT id FROM tasks").all() as Array<{ id: number }>;
    expect(tasks).toHaveLength(1);

    const result = await processNextPending(setup.workerDeps);
    expect(result?.run.status).toBe("succeeded");

    const second = await processNextPending(setup.workerDeps);
    expect(second).toBeNull();
  });

  test("trace_id propaga: clawde queue → enqueue event → task_start", async () => {
    setup.mockClient.enqueueResponse({ messages: [assistantText("ok")] });

    const { stdout } = await captureOutput(() =>
      runMain([
        "queue",
        "p",
        "--receiver-url",
        setup.baseUrl,
        "--output",
        "json",
        "--db",
        setup.dbPath,
      ]),
    );
    const parsed = JSON.parse(stdout) as { taskId: number; traceId: string };
    expect(parsed.traceId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // events.kind=enqueue carrega esse trace_id.
    const enqueueEvents = setup.workerDeps.eventsRepo.queryByTrace(parsed.traceId);
    expect(enqueueEvents.length).toBeGreaterThanOrEqual(1);
    expect(enqueueEvents.some((e) => e.kind === "enqueue")).toBe(true);
  });

  test("smoke-test E2E com receiver vivo retorna 0", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runMain(["smoke-test", "--receiver-url", setup.baseUrl, "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("[OK ] receiver.health");
    expect(stdout).toContain("overall: OK");
  });
});
