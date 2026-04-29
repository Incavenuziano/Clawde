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
import { makeTelegramHandler } from "./routes/telegram.ts";
import { type ReceiverHandle, createReceiver } from "./server.ts";
import { SystemdWorkerTrigger } from "./trigger.ts";

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
  const workerTrigger = new SystemdWorkerTrigger({
    signalPath: join(expandHome(config.clawde.home), "run", "queue.signal"),
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
    makeEnqueueHandler({ tasksRepo, eventsRepo, rateLimiter, logger, workerTrigger }),
  );
  const tg = config.telegram;
  if (tg !== undefined && tg.secret.length > 0 && tg.allowed_user_ids.length > 0) {
    handle.registerRoute(
      { method: "POST", path: "/webhook/telegram" },
      makeTelegramHandler({
        tasksRepo,
        eventsRepo,
        rateLimiter,
        logger,
        workerTrigger,
        config: {
          secret: tg.secret,
          allowedUserIds: tg.allowed_user_ids,
          defaultPriority: tg.default_priority,
          defaultAgent: tg.default_agent,
        },
      }),
    );
  } else {
    logger.info("telegram disabled (no config)");
  }
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

if (import.meta.main) {
  await bootstrap();
}
