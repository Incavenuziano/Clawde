/**
 * Repository: events (audit append-only).
 * UPDATE/DELETE bloqueados por triggers SQLite (events_no_update / events_no_delete).
 * DELETE só permitido se _retention_grant tem linha (job de retenção mensal).
 */

import type { Event, EventKind, NewEvent } from "@clawde/domain/event";
import { redact } from "@clawde/log";
import type { ClawdeDatabase } from "../client.ts";
import { JsonCorruptionError } from "./tasks.ts";

interface RawEventRow {
  id: number;
  ts: string;
  task_run_id: number | null;
  session_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  kind: EventKind;
  payload: string;
}

function rowToEvent(r: RawEventRow): Event {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(r.payload) as Record<string, unknown>;
  } catch (error) {
    throw new JsonCorruptionError(r.id, "payload", r.payload, { cause: error });
  }
  return {
    id: r.id,
    ts: r.ts,
    taskRunId: r.task_run_id,
    sessionId: r.session_id,
    traceId: r.trace_id,
    spanId: r.span_id,
    kind: r.kind,
    payload,
  };
}

export interface QueryEventsOptions {
  readonly onCorruption?: (error: JsonCorruptionError) => void;
}

function mapEvents(
  rows: ReadonlyArray<RawEventRow>,
  options?: QueryEventsOptions,
): ReadonlyArray<Event> {
  const events: Event[] = [];
  for (const row of rows) {
    try {
      events.push(rowToEvent(row));
    } catch (error) {
      if (error instanceof JsonCorruptionError && options?.onCorruption !== undefined) {
        options.onCorruption(error);
        continue;
      }
      throw error;
    }
  }
  return events;
}

export class EventsRepo {
  constructor(private readonly db: ClawdeDatabase) {}

  /**
   * INSERT em events. Único write permitido (UPDATE/DELETE bloqueados por triggers).
   */
  insert(input: NewEvent): Event {
    const safePayload = redact(input.payload) as Record<string, unknown>;
    const row = this.db
      .query<
        RawEventRow,
        [number | null, string | null, string | null, string | null, EventKind, string]
      >(
        `INSERT INTO events
           (task_run_id, session_id, trace_id, span_id, kind, payload)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.taskRunId,
        input.sessionId,
        input.traceId,
        input.spanId,
        input.kind,
        JSON.stringify(safePayload),
      );
    if (row === null) {
      throw new Error("INSERT...RETURNING returned null");
    }
    return rowToEvent(row);
  }

  queryByTaskRun(taskRunId: number, options?: QueryEventsOptions): ReadonlyArray<Event> {
    const rows = this.db
      .query<RawEventRow, [number]>("SELECT * FROM events WHERE task_run_id = ? ORDER BY ts, id")
      .all(taskRunId);
    return mapEvents(rows, options);
  }

  queryByTrace(traceId: string, options?: QueryEventsOptions): ReadonlyArray<Event> {
    const rows = this.db
      .query<RawEventRow, [string]>("SELECT * FROM events WHERE trace_id = ? ORDER BY ts, id")
      .all(traceId);
    return mapEvents(rows, options);
  }

  queryByKind(kind: EventKind, limit = 100, options?: QueryEventsOptions): ReadonlyArray<Event> {
    const rows = this.db
      .query<RawEventRow, [EventKind, number]>(
        "SELECT * FROM events WHERE kind = ? ORDER BY ts DESC LIMIT ?",
      )
      .all(kind, limit);
    return mapEvents(rows, options);
  }

  querySince(cutoffIso: string, limit = 100, options?: QueryEventsOptions): ReadonlyArray<Event> {
    const rows = this.db
      .query<RawEventRow, [string, number]>(
        "SELECT * FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT ?",
      )
      .all(cutoffIso, limit);
    return mapEvents(rows, options);
  }
}
