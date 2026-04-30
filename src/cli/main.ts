/**
 * `clawde` CLI entrypoint (BLUEPRINT §6).
 *
 * Parsing minimalista de argv (sem dep externa pra manter binary slim).
 * Subcomandos descobríveis via `clawde --help`.
 *
 * Exit codes:
 *   0 sucesso, 1 uso inválido, 2 erro operacional, 3 quota,
 *   4 auth, 5 fatal.
 */

import type { EventKind } from "@clawde/domain/event";
import { runAgents } from "./commands/agents.ts";
import { runAuth } from "./commands/auth.ts";
import { runDashboard } from "./commands/dashboard.ts";
import { runLogs } from "./commands/logs.ts";
import { runMemory } from "./commands/memory.ts";
import { runMigrate } from "./commands/migrate.ts";
import { runQueue } from "./commands/queue.ts";
import { runQuota } from "./commands/quota.ts";
import { runReplica } from "./commands/replica.ts";
import { runReview } from "./commands/review.ts";
import { runSmokeTest } from "./commands/smoke-test.ts";
import { runTrace } from "./commands/trace.ts";
import { type OutputFormat, emit, emitErr } from "./output.ts";

export interface ParsedArgs {
  readonly command: string;
  readonly positional: ReadonlyArray<string>;
  readonly flags: Readonly<Record<string, string | boolean>>;
}

/**
 * Parser de argv → ParsedArgs.
 * Suporta: --flag (boolean), --flag value, --flag=value, posicionais.
 */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const command = argv[0] ?? "help";
  const rest = argv.slice(1);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) continue;

    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx >= 0) {
        const k = token.slice(2, eqIdx);
        const v = token.slice(eqIdx + 1);
        flags[k] = v;
        continue;
      }
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
      continue;
    }

    positional.push(token);
  }

  return { command, positional, flags };
}

function getFlag(parsed: ParsedArgs, name: string, fallback?: string): string | undefined {
  const v = parsed.flags[name];
  if (v === undefined || v === false) return fallback;
  if (v === true) return "";
  return v;
}

function getOutputFormat(parsed: ParsedArgs): OutputFormat {
  const v = getFlag(parsed, "output", "text");
  return v === "json" ? "json" : "text";
}

function getDbPath(parsed: ParsedArgs): string {
  return (
    getFlag(parsed, "db") ?? process.env.CLAWDE_DB ?? `${process.env.HOME ?? ""}/.clawde/state.db`
  );
}

const HELP_TEXT = `clawde — daemon de execução de tasks Claude Code headless

Usage:
  clawde <command> [options]

Commands:
  queue <prompt>         Enfileira nova task
  migrate <up|status|down>  Aplica/reverte migrations
  smoke-test             Roda checagens de saúde
  auth <status|check>    Inspeciona OAuth token
  dashboard              Info do Datasette dashboard (URL, queries)
  replica <status|verify>  Saúde do Litestream replica
  review history <run-id>  Histórico do pipeline de review (Fase 9)
  agents list             Lista AGENT.md carregados
  version                Mostra semver
  help                   Esta mensagem

Common options:
  --db <path>            DB path (default ~/.clawde/state.db ou env CLAWDE_DB)
  --output {text|json}   Formato de output (default text)

Smoke options:
  --receiver-url <url>   Inclui check GET /health do receiver
  --include-sdk-ping     Faz ping real no SDK se CLAUDE_CODE_OAUTH_TOKEN presente

Migrate options:
  --audit-sandbox        Em migrate status, audita agentes com network="allowlist"
  --fail-on-allowlist    Com --audit-sandbox, retorna exit 2 se houver achados
  --agents-root <path>   Root dos agentes (default .claude/agents)
`;

export async function runMain(argv: ReadonlyArray<string>): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help" || parsed.flags.help === true) {
    emit("text", HELP_TEXT);
    return 0;
  }

  if (parsed.command === "version") {
    emit(
      getOutputFormat(parsed),
      { version: "0.0.1" },
      (d) => `clawde ${(d as { version: string }).version}`,
    );
    return 0;
  }

  if (parsed.command === "smoke-test") {
    const opts: Parameters<typeof runSmokeTest>[0] = {
      dbPath: getDbPath(parsed),
      format: getOutputFormat(parsed),
    };
    const recv = getFlag(parsed, "receiver-url");
    if (recv !== undefined) Object.assign(opts, { receiverUrl: recv });
    if (parsed.flags["include-sdk-ping"] === true) {
      Object.assign(opts, { includeSdkPing: true });
    }
    return await runSmokeTest(opts);
  }

  if (parsed.command === "migrate") {
    const action = parsed.positional[0] ?? "status";
    const dbPath = getDbPath(parsed);
    const format = getOutputFormat(parsed);
    const migrateCommon: Omit<Parameters<typeof runMigrate>[0], "action"> = {
      dbPath,
      format,
    };
    if (parsed.flags["audit-sandbox"] === true) {
      Object.assign(migrateCommon, { auditSandboxAllowlist: true });
    }
    if (parsed.flags["fail-on-allowlist"] === true) {
      Object.assign(migrateCommon, { failOnSandboxAllowlist: true });
    }
    const agentsRoot = getFlag(parsed, "agents-root");
    if (agentsRoot !== undefined && agentsRoot.length > 0) {
      Object.assign(migrateCommon, { agentsRoot });
    }

    if (action === "up") return runMigrate({ action: "up", ...migrateCommon });
    if (action === "status") return runMigrate({ action: "status", ...migrateCommon });
    if (action === "down") {
      const target = Number.parseInt(getFlag(parsed, "target", "0") ?? "0", 10);
      const confirm = parsed.flags.confirm === true;
      return runMigrate({ action: "down", ...migrateCommon, target, confirm });
    }
    emitErr(`unknown migrate action: ${action}`);
    return 1;
  }

  if (parsed.command === "queue") {
    const prompt = parsed.positional.join(" ");
    if (prompt.length === 0) {
      emitErr("error: prompt required (clawde queue <prompt>)");
      return 1;
    }
    const queueOpts: Parameters<typeof runQueue>[0] = {
      prompt,
      priority: getFlag(parsed, "priority", "NORMAL") ?? "NORMAL",
      agent: getFlag(parsed, "agent", "default") ?? "default",
      receiverUrl:
        getFlag(parsed, "receiver-url") ??
        process.env.CLAWDE_RECEIVER_URL ??
        "http://127.0.0.1:18790",
      format: getOutputFormat(parsed),
    };
    const sid = getFlag(parsed, "session-id");
    if (sid !== undefined) Object.assign(queueOpts, { sessionId: sid });
    const wd = getFlag(parsed, "working-dir");
    if (wd !== undefined) Object.assign(queueOpts, { workingDir: wd });
    const dk = getFlag(parsed, "dedup-key");
    if (dk !== undefined) Object.assign(queueOpts, { dedupKey: dk });
    return await runQueue(queueOpts);
  }

  if (parsed.command === "logs") {
    const dbPath = getDbPath(parsed);
    const format = getOutputFormat(parsed);
    const taskFlag = getFlag(parsed, "task");
    const taskRunId = taskFlag !== undefined ? Number.parseInt(taskFlag, 10) : undefined;
    const limit = Number.parseInt(getFlag(parsed, "limit", "100") ?? "100", 10);
    const opts: Parameters<typeof runLogs>[0] = {
      dbPath,
      format,
      limit,
    };
    if (taskRunId !== undefined && Number.isFinite(taskRunId)) {
      Object.assign(opts, { taskRunId });
    }
    const trace = getFlag(parsed, "trace");
    if (trace !== undefined) Object.assign(opts, { traceId: trace });
    const since = getFlag(parsed, "since");
    if (since !== undefined) Object.assign(opts, { since });
    const kind = getFlag(parsed, "kind");
    if (kind !== undefined) Object.assign(opts, { kind: kind as EventKind });
    return runLogs(opts);
  }

  if (parsed.command === "trace") {
    const traceId = parsed.positional[0];
    if (traceId === undefined) {
      emitErr("error: trace ID required (clawde trace <ulid>)");
      return 1;
    }
    return runTrace({
      dbPath: getDbPath(parsed),
      format: getOutputFormat(parsed),
      traceId,
    });
  }

  if (parsed.command === "quota") {
    const action = parsed.positional[0] ?? "status";
    if (action !== "status" && action !== "history") {
      emitErr(`unknown quota action: ${action} (use status|history)`);
      return 1;
    }
    return runQuota({
      dbPath: getDbPath(parsed),
      format: getOutputFormat(parsed),
      action,
    });
  }

  if (parsed.command === "agents") {
    const action = parsed.positional[0] ?? "list";
    if (action !== "list") {
      emitErr(`unknown agents action: ${action} (use list)`);
      return 1;
    }
    return runAgents({ format: getOutputFormat(parsed) });
  }

  if (parsed.command === "memory") {
    const action = parsed.positional[0];
    if (action === undefined) {
      emitErr("error: memory action required (search|show|stats|prune|reindex|recalc|inject)");
      return 1;
    }
    if (
      action !== "search" &&
      action !== "show" &&
      action !== "stats" &&
      action !== "prune" &&
      action !== "reindex" &&
      action !== "recalc" &&
      action !== "inject"
    ) {
      emitErr(`unknown memory action: ${action}`);
      return 1;
    }
    const opts: Parameters<typeof runMemory>[0] = {
      dbPath: getDbPath(parsed),
      format: getOutputFormat(parsed),
      action,
    };
    if (action === "search" || action === "inject") {
      // Posicionais 1+ formam o query.
      const queryParts = parsed.positional.slice(1);
      if (queryParts.length > 0) Object.assign(opts, { query: queryParts.join(" ") });
    }
    if (action === "show") {
      const idStr = parsed.positional[1];
      if (idStr !== undefined) {
        Object.assign(opts, { id: Number.parseInt(idStr, 10) });
      }
    }
    const topK = getFlag(parsed, "top-k");
    if (topK !== undefined) Object.assign(opts, { topK: Number.parseInt(topK, 10) });
    const kindFlag = getFlag(parsed, "kind");
    if (kindFlag !== undefined) Object.assign(opts, { kind: kindFlag });
    if (parsed.flags["dry-run"] === true) Object.assign(opts, { dryRun: true });
    const jsonlRoot = getFlag(parsed, "jsonl-root");
    if (jsonlRoot !== undefined) Object.assign(opts, { jsonlRoot });
    return await runMemory(opts);
  }

  if (parsed.command === "auth") {
    const action = parsed.positional[0] ?? "status";
    if (action !== "status" && action !== "check") {
      emitErr(`unknown auth action: ${action} (use status|check)`);
      return 1;
    }
    const opts: Parameters<typeof runAuth>[0] = {
      format: getOutputFormat(parsed),
      action,
    };
    const t = getFlag(parsed, "threshold-days");
    if (t !== undefined) {
      const n = Number.parseInt(t, 10);
      if (Number.isFinite(n) && n > 0) Object.assign(opts, { thresholdDays: n });
    }
    const cn = getFlag(parsed, "credential-name");
    if (cn !== undefined) Object.assign(opts, { credentialName: cn });
    return runAuth(opts);
  }

  if (parsed.command === "dashboard") {
    const opts: Parameters<typeof runDashboard>[0] = {
      format: getOutputFormat(parsed),
      url: getFlag(parsed, "url") ?? process.env.CLAWDE_DASHBOARD_URL ?? "http://127.0.0.1:18791",
    };
    const meta = getFlag(parsed, "metadata");
    if (meta !== undefined) Object.assign(opts, { metadataPath: meta });
    const t = getFlag(parsed, "timeout-ms");
    if (t !== undefined) {
      const n = Number.parseInt(t, 10);
      if (Number.isFinite(n) && n > 0) Object.assign(opts, { probeTimeoutMs: n });
    }
    return await runDashboard(opts);
  }

  if (parsed.command === "replica") {
    const action = parsed.positional[0] ?? "status";
    if (action !== "status" && action !== "verify") {
      emitErr(`unknown replica action: ${action} (use status|verify)`);
      return 1;
    }
    const replicasFlag = getFlag(parsed, "replicas");
    const expectedReplicas =
      replicasFlag !== undefined && replicasFlag.length > 0
        ? replicasFlag
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : ["b2"];
    const opts: Parameters<typeof runReplica>[0] = {
      format: getOutputFormat(parsed),
      action,
      dbPath: getDbPath(parsed),
      expectedReplicas,
    };
    const m = getFlag(parsed, "max-age-minutes");
    if (m !== undefined) {
      const n = Number.parseInt(m, 10);
      if (Number.isFinite(n) && n > 0) Object.assign(opts, { maxAgeMinutes: n });
    }
    return await runReplica(opts);
  }

  if (parsed.command === "review") {
    const action = parsed.positional[0] ?? "history";
    if (action !== "history") {
      emitErr(`unknown review action: ${action} (use history)`);
      return 1;
    }
    const idStr = parsed.positional[1];
    if (idStr === undefined) {
      emitErr("error: task_run id required (clawde review history <run-id>)");
      return 1;
    }
    const taskRunId = Number.parseInt(idStr, 10);
    if (!Number.isFinite(taskRunId)) {
      emitErr(`error: invalid run-id: ${idStr}`);
      return 1;
    }
    return runReview({
      format: getOutputFormat(parsed),
      action,
      dbPath: getDbPath(parsed),
      taskRunId,
    });
  }

  emitErr(`unknown command: ${parsed.command}\nrun 'clawde help' for usage`);
  return 1;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  runMain(argv).then(
    (exit) => process.exit(exit),
    (err) => {
      emitErr(`fatal: ${(err as Error).message}`);
      process.exit(5);
    },
  );
}
