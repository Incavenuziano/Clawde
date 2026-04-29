import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@clawde/config";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, setMinLevel } from "@clawde/log";
import { QuotaTracker } from "@clawde/quota";
import { TokenBucketRateLimiter } from "./auth/rate-limit.ts";
import { makeEnqueueHandler } from "./routes/enqueue.ts";
import { makeHealthHandler } from "./routes/health.ts";
import { type ReceiverHandle, createReceiver } from "./server.ts";

const VERSION = "0.0.1";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") return p.replace(/^~/, homedir());
  return p;
}

export async function bootstrap(): Promise<ReceiverHandle> {
  const config = loadConfig();
  setMinLevel(config.clawde.log_level);
  const logger = createLogger({ service: "receiver" });
  const dbPath = join(expandHome(config.clawde.home), "state.db");
  const db = openDb(dbPath);
  applyPending(db, defaultMigrationsDir());
  const tasksRepo = new TasksRepo(db);
  const eventsRepo = new EventsRepo(db);
  const quotaLedgerRepo = new QuotaLedgerRepo(db);
  const quotaTracker = new QuotaTracker(quotaLedgerRepo);
  const rateLimiter = new TokenBucketRateLimiter({
    perMinute: config.receiver.rate_limit.per_ip_per_minute,
    perHour: config.receiver.rate_limit.per_ip_per_hour,
  });
  const handle = createReceiver({
    listenTcp: config.receiver.listen_tcp,
    listenUnix: config.receiver.listen_unix,
    logger,
  });
  handle.registerRoute(
    { method: "GET", path: "/health" },
    makeHealthHandler({ db, quotaTracker, receiver: handle, version: VERSION }),
  );
  handle.registerRoute(
    { method: "POST", path: "/enqueue" },
    makeEnqueueHandler({ tasksRepo, eventsRepo, rateLimiter, logger }),
  );
  // TODO: T-003 (after P0.3) — register /webhook/telegram conditionally once
  //   TelegramConfigSchema is available in ClawdeConfig (PR #1).
  logger.info("telegram disabled (pending P0.3)");
  process.on("SIGTERM", () => {
    handle.setDraining(true);
    setTimeout(() => {
      handle.stop().then(() => {
        closeDb(db);
        process.exit(0);
      });
    }, 10_000);
  });
  process.on("SIGHUP", () => {
    logger.info("config reloaded");
  });
  return handle;
}
