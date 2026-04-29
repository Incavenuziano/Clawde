/**
 * `clawde smoke-test` — verificações de saúde diárias (BEST_PRACTICES §5.5).
 *
 * Versão Fase 2 (subset realizável):
 *   1. DB acessível + integrity_check ok
 *   2. Migrations atualizadas (current == latest)
 *   3. Config válida (já implícita no boot)
 *
 * Receiver health + worker dry-run + CLI version vêm em fases posteriores.
 */

import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { defaultMigrationsDir, status } from "@clawde/db/migrations";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface SmokeTestOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
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
        s.pending.length === 0
          ? `up to date (v${s.current})`
          : `pending: ${s.pending.join(", ")}`,
    };
  } catch (err) {
    return {
      name: "db.migrations",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

export function runSmokeTest(options: SmokeTestOptions): number {
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

  const allOk = checks.every((c) => c.ok);
  const report: SmokeReport = { ok: allOk, checks };

  emit(options.format, report, (d) => {
    const data = d as SmokeReport;
    const lines = data.checks.map(
      (c) => `[${c.ok ? "OK " : "FAIL"}] ${c.name}: ${c.detail ?? ""}`,
    );
    lines.push("");
    lines.push(`overall: ${data.ok ? "OK" : "FAIL"}`);
    return lines.join("\n");
  });

  return allOk ? 0 : 1;
}
