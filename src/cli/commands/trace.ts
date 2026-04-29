/**
 * `clawde trace <ulid>` — consolida events+messages cronologicamente
 * para uma trace_id.
 */

import { closeDb, openDb } from "@clawde/db/client";
import { EventsRepo } from "@clawde/db/repositories/events";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface TraceCmdOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  readonly traceId: string;
}

export function runTrace(options: TraceCmdOptions): number {
  try {
    const db = openDb(options.dbPath);
    try {
      const repo = new EventsRepo(db);
      const events = repo.queryByTrace(options.traceId);

      emit(options.format, { traceId: options.traceId, events }, (d) => {
        const data = d as { traceId: string; events: typeof events };
        if (data.events.length === 0) return `(no events for trace ${data.traceId})`;
        const header = `trace ${data.traceId} (${data.events.length} events)`;
        const body = data.events
          .map(
            (e) =>
              `  ${e.ts} [${e.kind}]${e.taskRunId !== null ? ` run=${e.taskRunId}` : ""} ${JSON.stringify(e.payload)}`,
          )
          .join("\n");
        return `${header}\n${body}`;
      });
      return 0;
    } finally {
      closeDb(db);
    }
  } catch (err) {
    emitErr(`error: ${(err as Error).message}`);
    return 2;
  }
}
