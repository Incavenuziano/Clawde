/**
 * `clawde events export|purge` — retenção de audit log (P6.3).
 *
 * export:
 *   Lê events com ts mais antigo que o cutoff relativo (`--since-cutoff 90d`)
 *   e grava JSONL em ~/.clawde/exports/events-YYYY-MM.jsonl.
 *
 * purge:
 *   Remove events com ts anterior a uma data absoluta (`--before YYYY-MM-DD`)
 *   usando _retention_grant para destravar trigger append-only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface EventsOptionsBase {
  readonly dbPath: string;
  readonly format: OutputFormat;
}

export interface EventsExportOptions extends EventsOptionsBase {
  readonly action: "export";
  readonly sinceCutoff: string;
}

export interface EventsPurgeOptions extends EventsOptionsBase {
  readonly action: "purge";
  readonly before: string;
  readonly confirm: boolean;
}

export type EventsAction = EventsExportOptions | EventsPurgeOptions;

interface ExportRow {
  id: number;
  ts: string;
  task_run_id: number | null;
  session_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  kind: string;
  payload: string;
}

function parseRelativeCutoffToSqlModifier(raw: string): string | null {
  const match = raw.match(/^(\d+)([mhdw])$/);
  if (match === null) return null;
  const amount = Number.parseInt(match[1] ?? "0", 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  if (unit === "m") return `-${amount} minutes`;
  if (unit === "h") return `-${amount} hours`;
  if (unit === "d") return `-${amount} days`;
  return `-${amount * 7} days`;
}

function resolveDefaultExportsDir(dbPath: string): string {
  const home = process.env.HOME;
  if (home !== undefined && home.length > 0) {
    return join(home, ".clawde", "exports");
  }
  return join(dirname(dbPath), "exports");
}

function monthStamp(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function runEventsExport(options: EventsExportOptions): number {
  const cutoffModifier = parseRelativeCutoffToSqlModifier(options.sinceCutoff);
  if (cutoffModifier === null) {
    emitErr(`invalid --since-cutoff '${options.sinceCutoff}' (expected like 90d, 12h, 30m, 2w)`);
    return 1;
  }

  let db: ClawdeDatabase;
  try {
    db = openDb(options.dbPath);
  } catch (err) {
    emitErr(`error opening db: ${(err as Error).message}`);
    return 2;
  }

  try {
    const rows = db
      .query<ExportRow, [string]>(
        `SELECT id, ts, task_run_id, session_id, trace_id, span_id, kind, payload
           FROM events
          WHERE ts < datetime('now', ?)
          ORDER BY ts, id`,
      )
      .all(cutoffModifier);

    const outputDir = resolveDefaultExportsDir(options.dbPath);
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `events-${monthStamp()}.jsonl`);

    const lines = rows.map((row) => {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = { parse_error: true, raw: row.payload };
      }
      return JSON.stringify({
        id: row.id,
        ts: row.ts,
        taskRunId: row.task_run_id,
        sessionId: row.session_id,
        traceId: row.trace_id,
        spanId: row.span_id,
        kind: row.kind,
        payload,
      });
    });
    const fileBody = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    writeFileSync(outputPath, fileBody, "utf-8");

    emit(
      options.format,
      { outputPath, exported: rows.length, sinceCutoff: options.sinceCutoff },
      (d) => {
        const data = d as { outputPath: string; exported: number; sinceCutoff: string };
        return `exported ${data.exported} events (< now-${data.sinceCutoff}) to ${data.outputPath}`;
      },
    );
    return 0;
  } catch (err) {
    emitErr(`error exporting events: ${(err as Error).message}`);
    return 2;
  } finally {
    closeDb(db);
  }
}

function isIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

function runEventsPurge(options: EventsPurgeOptions): number {
  if (!options.confirm) {
    emitErr("error: --confirm required for destructive purge");
    return 1;
  }
  if (!isIsoDate(options.before)) {
    emitErr(`error: invalid --before '${options.before}' (expected YYYY-MM-DD)`);
    return 1;
  }

  let db: ClawdeDatabase;
  try {
    db = openDb(options.dbPath);
  } catch (err) {
    emitErr(`error opening db: ${(err as Error).message}`);
    return 2;
  }

  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("INSERT INTO _retention_grant DEFAULT VALUES");
      db.run("DELETE FROM events WHERE ts < datetime(?, 'start of day')", [options.before]);
      const deleted = (
        db.query<{ n: number }, []>("SELECT changes() AS n").get() as { n: number } | null
      )?.n;
      db.exec("DELETE FROM _retention_grant");
      db.exec("COMMIT");

      emit(options.format, { before: options.before, deleted: deleted ?? 0 }, (d) => {
        const data = d as { before: string; deleted: number };
        return `purged ${data.deleted} events before ${data.before}`;
      });
      return 0;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } catch (err) {
    emitErr(`error purging events: ${(err as Error).message}`);
    return 2;
  } finally {
    closeDb(db);
  }
}

export function runEvents(action: EventsAction): number {
  if (action.action === "export") return runEventsExport(action);
  return runEventsPurge(action);
}
