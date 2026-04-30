/**
 * `clawde logs` — consulta events table com filtros.
 *
 * Flags:
 *   --task <id>       Tudo de 1 task_run
 *   --trace <ulid>    Tudo de 1 trace
 *   --since <duration>  ex: 1h, 24h, 7d (relativo a now)
 *   --kind <event-kind>  Filtra events.kind
 *   --limit <N>       Default 100
 *
 * Não implementa --follow nesta fase (Fase 5+).
 */

import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { EventsRepo } from "@clawde/db/repositories/events";
import type { JsonCorruptionError } from "@clawde/db/repositories/tasks";
import type { Event, EventKind } from "@clawde/domain/event";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface LogsOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  readonly taskRunId?: number;
  readonly traceId?: string;
  readonly since?: string;
  readonly kind?: EventKind;
  readonly limit: number;
}

function parseSinceToMs(since: string): number | null {
  const m = since.match(/^(\d+)([smhd])$/);
  if (m === null) return null;
  const n = Number.parseInt(m[1] ?? "0", 10);
  const unit = m[2];
  switch (unit) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return null;
  }
}

function renderEventLine(e: Event): string {
  const trace = e.traceId !== null ? ` trace=${e.traceId.slice(0, 8)}` : "";
  const taskRun = e.taskRunId !== null ? ` run=${e.taskRunId}` : "";
  return `${e.ts} [${e.kind}]${taskRun}${trace} ${JSON.stringify(e.payload)}`;
}

export function runLogs(options: LogsOptions): number {
  let db: ClawdeDatabase;
  try {
    db = openDb(options.dbPath);
  } catch (err) {
    emitErr(`error opening db: ${(err as Error).message}`);
    return 2;
  }

  try {
    const repo = new EventsRepo(db);
    let events: ReadonlyArray<Event> = [];
    let corruptedRows = 0;
    const onCorruption = (error: JsonCorruptionError): void => {
      corruptedRows += 1;
      emitErr(`WARN: row ${error.rowId} corrupted (column ${error.column}); skipping`);
    };

    if (options.taskRunId !== undefined) {
      events = repo.queryByTaskRun(options.taskRunId, { onCorruption });
    } else if (options.traceId !== undefined) {
      events = repo.queryByTrace(options.traceId, { onCorruption });
    } else if (options.kind !== undefined) {
      events = repo.queryByKind(options.kind, options.limit, { onCorruption });
    } else if (options.since !== undefined) {
      const ms = parseSinceToMs(options.since);
      if (ms === null) {
        emitErr(`invalid --since format: ${options.since} (expected like 1h, 24h, 7d)`);
        return 1;
      }
      const cutoff = new Date(Date.now() - ms).toISOString();
      events = repo.querySince(cutoff, options.limit, { onCorruption });
    } else {
      emitErr("error: at least one of --task, --trace, --since, --kind required");
      return 1;
    }

    emit(options.format, events, (d) => {
      const list = d as ReadonlyArray<Event>;
      if (list.length === 0) {
        if (corruptedRows > 0) return "(no events; all matching rows were corrupted)";
        return "(no events)";
      }
      return list.map(renderEventLine).join("\n");
    });
    return 0;
  } finally {
    closeDb(db);
  }
}
