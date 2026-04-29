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

import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { defaultMigrationsDir, status } from "@clawde/db/migrations";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface SmokeTestOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  /** Se definido, checa GET /health. */
  readonly receiverUrl?: string;
  /** Timeout pra check de receiver. */
  readonly receiverTimeoutMs?: number;
}

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

interface SmokeReport {
  readonly ok: boolean;
  readonly checks: ReadonlyArray<CheckResult>;
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

  if (options.receiverUrl !== undefined && options.receiverUrl.length > 0) {
    checks.push(await checkReceiverHealth(options.receiverUrl, options.receiverTimeoutMs ?? 2000));
  }

  const allOk = checks.every((c) => c.ok);
  const report: SmokeReport = { ok: allOk, checks };

  emit(options.format, report, (d) => {
    const data = d as SmokeReport;
    const lines = data.checks.map((c) => `[${c.ok ? "OK " : "FAIL"}] ${c.name}: ${c.detail ?? ""}`);
    lines.push("");
    lines.push(`overall: ${data.ok ? "OK" : "FAIL"}`);
    return lines.join("\n");
  });

  return allOk ? 0 : 1;
}
