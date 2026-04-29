import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@clawde/config";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, setMinLevel } from "@clawde/log";
import { QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import { RealAgentClient } from "@clawde/sdk";
import { LeaseManager, makeReconciler, processNextPending } from "./index.ts";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") return p.replace(/^~/, homedir());
  return p;
}

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  setMinLevel(config.clawde.log_level);
  const logger = createLogger({ service: "worker" });
  const dbPath = join(expandHome(config.clawde.home), "state.db");
  const db = openDb(dbPath);
  try {
    applyPending(db, defaultMigrationsDir());
    const tasksRepo = new TasksRepo(db);
    const runsRepo = new TaskRunsRepo(db);
    const eventsRepo = new EventsRepo(db);
    const quotaTracker = new QuotaTracker(new QuotaLedgerRepo(db));
    const quotaPolicy = makeQuotaPolicy();
    const leaseManager = new LeaseManager(runsRepo, eventsRepo, {
      leaseSeconds: config.worker.lease_seconds,
      heartbeatSeconds: config.worker.heartbeat_seconds,
    });
    const reconciler = makeReconciler(runsRepo, eventsRepo);
    const agentClient = new RealAgentClient();
    const workerId = `${hostname()}-${process.pid}-${Date.now()}`;
    const reconcileResult = reconciler.reconcile(workerId);
    logger.info("startup reconcile", {
      expired_count: reconcileResult.expired.length,
      reenqueued_count: reconcileResult.reenqueued.length,
    });
    // TODO: T-029 (after P1.2) — inject quota policy; for now loop is unthrottled
    const maxTasks = 50;
    let processed = 0;
    while (processed < maxTasks) {
      // T-008 (blocked, after P1.2 T-029): quota gate goes here
      const result = await processNextPending({
        tasksRepo,
        runsRepo,
        eventsRepo,
        leaseManager,
        quotaTracker,
        quotaPolicy,
        agentClient,
        logger,
        workerId,
      });
      if (result === null) break;
      processed += 1;
    }
    logger.info("worker idle", { processed });
  } finally {
    closeDb(db);
  }
}

if (import.meta.main) {
  bootstrap().then(() => process.exit(0));
}
