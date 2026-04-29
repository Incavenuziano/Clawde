/**
 * Repository: events (audit append-only).
 * UPDATE/DELETE bloqueados por triggers SQLite (events_no_update / events_no_delete).
 * DELETE só permitido se _retention_grant tem linha (job de retenção mensal).
 */

import type { ClawdeDatabase } from "../client.ts";
import type { Event, EventKind, NewEvent } from "@clawde/domain/event";

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
  return {
    id: r.id,
    ts: r.ts,
    taskRunId: r.task_run_id,
    sessionId: r.session_id,
    traceId: r.trace_id,
    spanId: r.span_id,
    kind: r.kind,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
  };
}

export class EventsRepo {
  constructor(private readonly db: ClawdeDatabase) {}

  /**
   * INSERT em events. Único write permitido (UPDATE/DELETE bloqueados por triggers).
   */
  insert(input: NewEvent): Event {
    const row = this.db
      .query<RawEventRow, [number | null, string | null, string | null, string | null, EventKind, string]>(
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
        JSON.stringify(input.payload),
      );
    if (row === null) {
      throw new Error("INSERT...RETURNING returned null");
    }
    return rowToEvent(row);
  }

  queryByTaskRun(taskRunId: number): ReadonlyArray<Event> {
    const rows = this.db
      .query<RawEventRow, [number]>(
        "SELECT * FROM events WHERE task_run_id = ? ORDER BY ts, id",
      )
      .all(taskRunId);
    return rows.map(rowToEvent);
  }

  queryByTrace(traceId: string): ReadonlyArray<Event> {
    const rows = this.db
      .query<RawEventRow, [string]>("SELECT * FROM events WHERE trace_id = ? ORDER BY ts, id")
      .all(traceId);
    return rows.map(rowToEvent);
  }

  queryByKind(kind: EventKind, limit = 100): ReadonlyArray<Event> {
    const rows = this.db
      .query<RawEventRow, [EventKind, number]>(
        "SELECT * FROM events WHERE kind = ? ORDER BY ts DESC LIMIT ?",
      )
      .all(kind, limit);
    return rows.map(rowToEvent);
  }
}
