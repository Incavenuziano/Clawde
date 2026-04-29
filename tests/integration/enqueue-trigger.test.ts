import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import {
  type ReceiverHandle,
  TokenBucketRateLimiter,
  type WorkerTrigger,
  createReceiver,
} from "@clawde/receiver";
import { makeEnqueueHandler } from "@clawde/receiver/routes/enqueue";

interface Setup {
  readonly db: ClawdeDatabase;
  readonly receiver: ReceiverHandle;
  readonly baseUrl: string;
  readonly cleanup: () => void;
}

let portCounter = 39200;
function nextPort(): number {
  return portCounter++;
}

class FakeWorkerTrigger implements WorkerTrigger {
  calls: Array<{ traceId: string; atMs: number }> = [];
  async trigger(traceId: string): Promise<void> {
    this.calls.push({ traceId, atMs: Date.now() });
  }
}

async function start(trigger: FakeWorkerTrigger): Promise<Setup> {
  const dir = mkdtempSync(join(tmpdir(), "clawde-trigger-"));
  const db = openDb(join(dir, "state.db"));
  applyPending(db, defaultMigrationsDir());
  const tcp = `127.0.0.1:${nextPort()}`;

  setLogSink(() => {});
  const logger = createLogger({ component: "test-enqueue-trigger" });
  const receiver = createReceiver({ listenTcp: tcp, logger });
  receiver.registerRoute(
    { method: "POST", path: "/enqueue" },
    makeEnqueueHandler({
      tasksRepo: new TasksRepo(db),
      eventsRepo: new EventsRepo(db),
      rateLimiter: new TokenBucketRateLimiter({ perMinute: 20, perHour: 200 }),
      logger,
      workerTrigger: trigger,
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

describe("receiver enqueue trigger", () => {
  let setup: Setup;
  let trigger: FakeWorkerTrigger;

  beforeEach(async () => {
    trigger = new FakeWorkerTrigger();
    setup = await start(trigger);
  });
  afterEach(() => setup.cleanup());

  test("enqueue dispara WorkerTrigger em <1s com mesmo traceId", async () => {
    const startedAt = Date.now();
    const response = await fetch(`${setup.baseUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "trigger me" }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { traceId: string; deduped: boolean };
    expect(body.deduped).toBe(false);

    expect(trigger.calls.length).toBe(1);
    const call = trigger.calls[0];
    expect(call?.traceId).toBe(body.traceId);
    expect((call?.atMs ?? Number.MAX_SAFE_INTEGER) - startedAt).toBeLessThan(1000);
  });
});
