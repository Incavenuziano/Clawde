import { homedir, hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { AgentDefinitionError, loadAllAgentDefinitionsWithWarnings } from "@clawde/agents";
import { sendAlertBestEffort } from "@clawde/alerts";
import { loadConfig } from "@clawde/config";
import { closeDb, openDb } from "@clawde/db/client";
import {
  SLOW_INTEGRITY_CHECK_MS,
  isDbIntegrityOk,
  runDbIntegrityChecks,
} from "@clawde/db/integrity";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, setMinLevel } from "@clawde/log";
import { QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import { RealAgentClient } from "@clawde/sdk";
import { LeaseManager, type RunnerDeps, makeReconciler, processNextPending } from "./index.ts";

const DEFAULT_MAX_TASKS = 50;

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") return p.replace(/^~/, homedir());
  return p;
}

export function parseMaxTasks(argv: ReadonlyArray<string>, fallback = DEFAULT_MAX_TASKS): number {
  const idx = argv.indexOf("--max-tasks");
  if (idx < 0 || idx + 1 >= argv.length) return fallback;
  const raw = argv[idx + 1];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseDryRun(argv: ReadonlyArray<string>): boolean {
  return argv.includes("--dry-run");
}

export type LoopExitReason = "empty" | "deferred" | "max_tasks";

export interface LoopResult {
  readonly processed: number;
  readonly exitReason: LoopExitReason;
}

function assertStartupDbIntegrity(
  db: ReturnType<typeof openDb>,
  logger: ReturnType<typeof createLogger>,
): void {
  const report = runDbIntegrityChecks(db);
  if (report.elapsedMs > SLOW_INTEGRITY_CHECK_MS) {
    logger.warn("startup integrity_check slow", {
      elapsed_ms: report.elapsedMs,
      threshold_ms: SLOW_INTEGRITY_CHECK_MS,
    });
  }
  if (isDbIntegrityOk(report)) {
    return;
  }

  const payload = {
    integrity_check: report.integrityCheck,
    quick_check: report.quickCheck,
    foreign_key_violations: report.foreignKeyViolations.length,
    elapsed_ms: report.elapsedMs,
  } as const;
  try {
    new EventsRepo(db).insert({
      taskRunId: null,
      sessionId: null,
      traceId: null,
      spanId: null,
      kind: "db_corrupted",
      payload,
    });
  } catch (err) {
    logger.error("failed to persist db_corrupted event", {
      error: (err as Error).message,
    });
  }

  logger.error("db integrity failed; entering readonly mode", payload);
  void sendAlertBestEffort({
    severity: "critical",
    trigger: "db_corrupted",
    cooldownKey: "db_corrupted",
    payload,
  });
  throw new Error(
    `db integrity failed (integrity_check=${report.integrityCheck}, quick_check=${report.quickCheck}, fk=${report.foreignKeyViolations.length})`,
  );
}

export async function runProcessLoop(deps: RunnerDeps, maxTasks: number): Promise<LoopResult> {
  let processed = 0;
  while (processed < maxTasks) {
    const result = await processNextPending(deps);
    if (result === null) return { processed, exitReason: "empty" };
    if (result.agentResult.stopReason === "deferred") {
      return { processed, exitReason: "deferred" };
    }
    processed += 1;
  }
  return { processed, exitReason: "max_tasks" };
}

export async function bootstrap(
  argv: ReadonlyArray<string> = process.argv.slice(2),
): Promise<void> {
  const config = loadConfig();
  setMinLevel(config.clawde.log_level);
  const logger = createLogger({ service: "worker" });
  const dbPath = join(expandHome(config.clawde.home), "state.db");
  const db = openDb(dbPath);
  try {
    applyPending(db, defaultMigrationsDir());
    assertStartupDbIntegrity(db, logger);
    const tasksRepo = new TasksRepo(db);
    const runsRepo = new TaskRunsRepo(db);
    const eventsRepo = new EventsRepo(db);
    const quotaTracker = new QuotaTracker(new QuotaLedgerRepo(db));
    const quotaPolicy = makeQuotaPolicy();
    const leaseManager = new LeaseManager(runsRepo, eventsRepo, {
      leaseSeconds: config.worker.lease_seconds,
      heartbeatSeconds: config.worker.heartbeat_seconds,
    });
    const reconciler = makeReconciler(runsRepo, eventsRepo, {
      tasksRepo,
      workspaceTmpRoot: "/tmp",
    });
    const agentsRoot = join(expandHome(config.clawde.home), "agents");
    const agentDefs = (() => {
      try {
        return loadAllAgentDefinitionsWithWarnings(agentsRoot, {
          onWarning: (warning) => {
            if (warning.kind === "bash_disallowed_by_sandbox_level") {
              logger.warn("agent policy mismatch: Bash will be blocked at runtime", {
                agent: warning.agentName,
                sandbox_level: warning.sandboxLevel,
                hint: "Set sandbox level to 1 or remove Bash from allowedTools (ADR 0015 / T-050).",
              });
            }
          },
        });
      } catch (err) {
        if (err instanceof AgentDefinitionError) {
          const agentName = basename(dirname(err.agentPath));
          throw new Error(`agent ${agentName} invalid: ${err.message}`);
        }
        throw err;
      }
    })();
    const agentDefByName = new Map(agentDefs.map((d) => [d.name, d] as const));
    const agentClient = new RealAgentClient();
    const workerId = `${hostname()}-${process.pid}-${Date.now()}`;
    const reconcileResult = reconciler.reconcile(workerId);
    logger.info("startup reconcile", {
      expired_count: reconcileResult.expired.length,
      reenqueued_count: reconcileResult.reenqueued.length,
      cleaned_orphans: reconcileResult.cleanedOrphans,
    });
    const maxTasks = parseMaxTasks(argv);
    const dryRun = parseDryRun(argv);
    const queueSize = tasksRepo.findPending(1000).length;
    const quotaState = quotaTracker.currentWindow().state;
    logger.info("worker bootstrap state", {
      dry_run: dryRun,
      agents_loaded: agentDefs.length,
      queue_size: queueSize,
      quota_state: quotaState,
    });

    if (dryRun) {
      logger.info("worker dry-run complete", {
        agents_loaded: agentDefs.length,
        queue_size: queueSize,
        quota_state: quotaState,
      });
      return;
    }

    const loop = await runProcessLoop(
      {
        tasksRepo,
        runsRepo,
        eventsRepo,
        leaseManager,
        quotaTracker,
        quotaPolicy,
        agentClient,
        logger,
        workerId,
        workspaceConfig: { tmpRoot: "/tmp", baseBranch: "main" },
        resolveAgentDefinition: async (agent) => agentDefByName.get(agent) ?? null,
      },
      maxTasks,
    );
    logger.info("worker idle", {
      processed: loop.processed,
      max_tasks: maxTasks,
      exit_reason: loop.exitReason,
    });
  } finally {
    closeDb(db);
  }
}

if (import.meta.main) {
  bootstrap()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error((err as Error).message);
      process.exit(1);
    });
}
