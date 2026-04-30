/**
 * `clawde smoke-test` — verificações de saúde diárias (BEST_PRACTICES §5.5).
 *
 * Checks (Fase 3):
 *   1. DB acessível + integrity_check ok
 *   2. Migrations atualizadas (current == latest)
 *   3. Receiver health (opcional, se --receiver-url passado)
 *
 * Worker dry-run + CLI version checks vêm em fases posteriores.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { AgentDefinitionError, loadAllAgentDefinitions } from "@clawde/agents";
import { OAuthLoadError, getTokenExpiry, loadOAuthToken } from "@clawde/auth";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { defaultMigrationsDir, status } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { RealAgentClient } from "@clawde/sdk";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface SmokeTestOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  /** Se definido, checa GET /health. */
  readonly receiverUrl?: string;
  /** Timeout pra check de receiver. */
  readonly receiverTimeoutMs?: number;
  /** Habilita ping real no SDK quando token estiver presente. */
  readonly includeSdkPing?: boolean;
}

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
  readonly eventKind?: "smoke.sdk_real_ping_ok" | "smoke.sdk_real_ping_fail";
}

interface SmokeReport {
  readonly ok: boolean;
  readonly checks: ReadonlyArray<CheckResult>;
}

function envForSmokeChecks(dbPath: string): Record<string, string | undefined> {
  const explicitConfig = process.env.CLAWDE_CONFIG;
  return {
    ...(process.env as Record<string, string | undefined>),
    // Torna smoke independente de ~/.clawde global em ambientes de teste.
    CLAWDE_HOME:
      process.env.CLAWDE_HOME !== undefined && process.env.CLAWDE_HOME.length > 0
        ? process.env.CLAWDE_HOME
        : dirname(dbPath),
    // Evita acoplamento com config global implícita via $HOME quando não há
    // CLAWDE_CONFIG explícito no ambiente.
    CLAWDE_CONFIG: explicitConfig !== undefined && explicitConfig.length > 0 ? explicitConfig : "",
  };
}

function checkIntegrity(db: ClawdeDatabase): CheckResult {
  try {
    const row = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
    const result = row?.integrity_check ?? "(no result)";
    return {
      name: "db.integrity_check",
      ok: result === "ok",
      detail: result,
    };
  } catch (err) {
    return {
      name: "db.integrity_check",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

function checkMigrations(db: ClawdeDatabase): CheckResult {
  try {
    const s = status(db, defaultMigrationsDir());
    return {
      name: "db.migrations",
      ok: s.pending.length === 0 && s.current === s.latest,
      detail:
        s.pending.length === 0 ? `up to date (v${s.current})` : `pending: ${s.pending.join(", ")}`,
    };
  } catch (err) {
    return {
      name: "db.migrations",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function checkReceiverHealth(url: string, timeoutMs: number): Promise<CheckResult> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${url}/health`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 200) {
      const body = (await response.json()) as { quota?: string; version?: string };
      return {
        name: "receiver.health",
        ok: true,
        detail: `quota=${body.quota ?? "?"} version=${body.version ?? "?"}`,
      };
    }
    return {
      name: "receiver.health",
      ok: false,
      detail: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      name: "receiver.health",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function checkWorkerDryRun(dbPath: string): Promise<CheckResult> {
  const bunPath = Bun.which("bun") ?? "bun";
  const workerPath = "dist/worker-main.js";
  if (!existsSync(workerPath)) {
    return {
      name: "worker.dry_run",
      ok: false,
      detail: `${workerPath} not found (run bun run build:worker)`,
    };
  }
  const proc = Bun.spawn([bunPath, "run", workerPath, "--dry-run"], {
    stdout: "pipe",
    stderr: "pipe",
    env: envForSmokeChecks(dbPath),
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const output = `${stdout}\n${stderr}`;
  if (exitCode !== 0) {
    return {
      name: "worker.dry_run",
      ok: false,
      detail: `exit=${exitCode}`,
    };
  }
  return {
    name: "worker.dry_run",
    ok: true,
    detail:
      output.trim().length > 0 ? "worker dry-run exited 0" : "worker dry-run exited 0 (silent)",
  };
}

function checkBwrapForSandboxAgents(dbPath: string): CheckResult {
  try {
    const env = envForSmokeChecks(dbPath);
    const root = join(env.CLAWDE_HOME ?? dirname(dbPath), "agents");
    const defs = loadAllAgentDefinitions(root);
    const needsBwrap = defs.some((d) => d.sandbox.level >= 2);
    if (!needsBwrap) {
      return {
        name: "sandbox.bwrap_presence",
        ok: true,
        detail: "no level>=2 agents loaded",
      };
    }
    const bwrapPath = "/usr/bin/bwrap";
    return {
      name: "sandbox.bwrap_presence",
      ok: existsSync(bwrapPath),
      detail: existsSync(bwrapPath)
        ? `${bwrapPath} present`
        : `${bwrapPath} missing but level>=2 agents exist`,
    };
  } catch (err) {
    const detail = err instanceof AgentDefinitionError ? err.message : (err as Error).message;
    return {
      name: "sandbox.bwrap_presence",
      ok: false,
      detail,
    };
  }
}

function checkOAuthExpiry(): CheckResult {
  try {
    const token = loadOAuthToken();
    const expiry = getTokenExpiry(token.value);
    if (expiry.daysUntilExpiry === null) {
      return {
        name: "auth.oauth_expiry",
        ok: true,
        detail: "token loaded; expiry unknown (non-JWT or missing exp)",
      };
    }
    const days = Math.round(expiry.daysUntilExpiry * 10) / 10;
    if (days < 7) {
      return {
        name: "auth.oauth_expiry",
        ok: false,
        detail: `expires in ${days}d (<7d)`,
      };
    }
    if (days < 30) {
      return {
        name: "auth.oauth_expiry",
        ok: true,
        detail: `warning: expires in ${days}d (<30d)`,
      };
    }
    return {
      name: "auth.oauth_expiry",
      ok: true,
      detail: `expires in ${days}d`,
    };
  } catch (err) {
    if (err instanceof OAuthLoadError) {
      return {
        name: "auth.oauth_expiry",
        ok: true,
        detail: "token not found; check skipped",
      };
    }
    return {
      name: "auth.oauth_expiry",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function checkSdkRealPing(include: boolean): Promise<CheckResult> {
  if (!include) {
    return { name: "sdk.real_ping", ok: true, detail: "skipped (flag disabled)" };
  }
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (token === undefined || token.length === 0) {
    return { name: "sdk.real_ping", ok: true, detail: "skipped (token missing)" };
  }
  try {
    const client = new RealAgentClient();
    const result = await client.run({
      prompt: "Reply with exactly: pong",
      maxTurns: 1,
    });
    if (result.stopReason === "error" || result.error !== null) {
      return {
        name: "sdk.real_ping",
        ok: false,
        detail: result.error ?? "unknown sdk error",
        eventKind: "smoke.sdk_real_ping_fail",
      };
    }
    return {
      name: "sdk.real_ping",
      ok: true,
      detail: `ok (${result.msgsConsumed} msgs, stop=${result.stopReason})`,
      eventKind: "smoke.sdk_real_ping_ok",
    };
  } catch (err) {
    return {
      name: "sdk.real_ping",
      ok: false,
      detail: (err as Error).message,
      eventKind: "smoke.sdk_real_ping_fail",
    };
  }
}

export async function runSmokeTest(options: SmokeTestOptions): Promise<number> {
  let db: ClawdeDatabase;
  try {
    db = openDb(options.dbPath);
  } catch (err) {
    emitErr(`error opening db: ${(err as Error).message}`);
    return 2;
  }

  const checks: CheckResult[] = [];
  try {
    checks.push(checkIntegrity(db));
    checks.push(checkMigrations(db));
  } finally {
    closeDb(db);
  }

  checks.push(await checkWorkerDryRun(options.dbPath));
  checks.push(checkBwrapForSandboxAgents(options.dbPath));
  checks.push(checkOAuthExpiry());
  const sdkPing = await checkSdkRealPing(options.includeSdkPing === true);
  checks.push(sdkPing);

  if (options.receiverUrl !== undefined && options.receiverUrl.length > 0) {
    checks.push(await checkReceiverHealth(options.receiverUrl, options.receiverTimeoutMs ?? 2000));
  }

  const allOk = checks.every((c) => c.ok);
  const report: SmokeReport = { ok: allOk, checks };

  if (sdkPing.eventKind !== undefined) {
    try {
      const eventsDb = openDb(options.dbPath);
      try {
        const events = new EventsRepo(eventsDb);
        events.insert({
          taskRunId: null,
          sessionId: null,
          traceId: null,
          spanId: null,
          kind: sdkPing.eventKind,
          payload: {
            detail: sdkPing.detail ?? "",
            ok: sdkPing.ok,
          },
        });
      } finally {
        closeDb(eventsDb);
      }
    } catch {
      // Smoke não falha por erro de telemetria.
    }
  }

  emit(options.format, report, (d) => {
    const data = d as SmokeReport;
    const lines = data.checks.map((c) => `[${c.ok ? "OK " : "FAIL"}] ${c.name}: ${c.detail ?? ""}`);
    lines.push("");
    lines.push(`overall: ${data.ok ? "OK" : "FAIL"}`);
    return lines.join("\n");
  });

  return allOk ? 0 : 1;
}
