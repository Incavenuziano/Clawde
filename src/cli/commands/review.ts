/**
 * `clawde review history <task-run-id>` — mostra eventos do pipeline de
 * review pra um task-run específico (Fase 9, ADR 0004).
 *
 * Não dispara pipeline novo aqui — o worker chama runReviewPipeline.
 * Esta CLI é puramente leitura sobre `events` (kinds review.*).
 */

import { closeDb, openDb } from "@clawde/db/client";
import { EventsRepo } from "@clawde/db/repositories/events";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface ReviewCmdOptions {
  readonly format: OutputFormat;
  readonly action: "history";
  readonly dbPath: string;
  readonly taskRunId: number;
}

const REVIEW_KINDS = [
  "review.implementer.start",
  "review.implementer.end",
  "review.spec.start",
  "review.spec.verdict",
  "review.quality.start",
  "review.quality.verdict",
  "review.pipeline.complete",
  "review.pipeline.exhausted",
] as const;

export function runReview(options: ReviewCmdOptions): number {
  let db: ReturnType<typeof openDb>;
  try {
    db = openDb(options.dbPath);
  } catch (err) {
    emitErr(`error opening db: ${(err as Error).message}`);
    return 2;
  }
  try {
    const repo = new EventsRepo(db);
    const all = repo.queryByTaskRun(options.taskRunId);
    const reviewEvents = all.filter((e) => REVIEW_KINDS.includes(e.kind as never));

    emit(options.format, { taskRunId: options.taskRunId, events: reviewEvents }, (d) => {
      const data = d as { taskRunId: number; events: typeof reviewEvents };
      if (data.events.length === 0) return `(no review events for task_run=${data.taskRunId})`;
      const lines: string[] = [`task_run: ${data.taskRunId}`, ""];
      for (const e of data.events) {
        const verdict =
          typeof e.payload.verdict === "string" ? ` verdict=${e.payload.verdict}` : "";
        const attempt =
          typeof e.payload.attempt_n === "number" ? ` attempt=${e.payload.attempt_n}` : "";
        lines.push(`  ${e.ts}  ${e.kind}${attempt}${verdict}`);
      }
      return lines.join("\n");
    });
    return 0;
  } finally {
    closeDb(db);
  }
}
