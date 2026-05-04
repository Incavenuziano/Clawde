/**
 * `clawde result <task-id>` — exibe o resultado de uma task concluída.
 *
 * Serve a partir de `task_runs.result` (DB) quando disponível.
 * Se NULL, faz fallback para um resumo dos eventos da task_run.
 * Fix para #42: task_runs.result = NULL quando agente responde via tool calls.
 */

import { closeDb, openDb } from "@clawde/db/client";
import { EventsRepo } from "@clawde/db/repositories/events";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface ResultOptions {
  readonly taskId: number;
  readonly dbPath: string;
  readonly format: OutputFormat;
}

export interface ResultReport {
  readonly taskId: number;
  readonly taskRunId: number | null;
  readonly status: string | null;
  readonly result: string | null;
  readonly resultSource: "db" | "events_summary" | "none";
  readonly error: string | null;
  readonly msgsConsumed: number | null;
  readonly sessionId: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export async function runResult(options: ResultOptions): Promise<number> {
  const db = openDb(options.dbPath);
  try {
    const tasksRepo = new TasksRepo(db);
    const runsRepo = new TaskRunsRepo(db);
    const eventsRepo = new EventsRepo(db);

    const task = tasksRepo.findById(options.taskId);
    if (task === null) {
      emitErr(`error: task ${options.taskId} not found`);
      return 1;
    }

    const run = runsRepo.findLatestByTaskId(options.taskId);
    if (run === null) {
      emitErr(`error: no task_run found for task ${options.taskId}`);
      return 1;
    }

    let resultText: string | null = run.result;
    let resultSource: ResultReport["resultSource"] = "db";

    if ((resultText === null || resultText.length === 0) && run.status === "succeeded") {
      // Fallback: build summary from tool_use events of this run.
      const toolEvents = eventsRepo.queryByTaskRun(run.id).filter((e) => e.kind === "tool_use");

      if (toolEvents.length > 0) {
        const toolCounts = new Map<string, number>();
        for (const ev of toolEvents) {
          const toolName =
            typeof ev.payload === "object" && ev.payload !== null && "tool_name" in ev.payload
              ? String((ev.payload as Record<string, unknown>).tool_name ?? "unknown")
              : "tool";
          toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);
        }
        const summary = [...toolCounts.entries()]
          .map(([name, count]) => `${name}${count > 1 ? `×${count}` : ""}`)
          .join(", ");
        resultText = `[Completed via tool calls: ${summary}]`;
        resultSource = "events_summary";
      } else {
        resultSource = "none";
      }
    }

    const report: ResultReport = {
      taskId: task.id,
      taskRunId: run.id,
      status: run.status,
      result: resultText,
      resultSource,
      error: run.error,
      msgsConsumed: run.msgsConsumed ?? null,
      sessionId: task.sessionId ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
    };

    emit(options.format, report, (d) => {
      const r = d as ResultReport;
      const lines: string[] = [
        `task:    ${r.taskId}`,
        `run:     ${r.taskRunId ?? "—"}`,
        `status:  ${r.status ?? "—"}`,
        `msgs:    ${r.msgsConsumed ?? "—"}`,
        `session: ${r.sessionId ?? "—"}`,
        `started: ${r.startedAt ?? "—"}`,
        `ended:   ${r.finishedAt ?? "—"}`,
        "",
      ];
      if (r.result !== null && r.result.length > 0) {
        lines.push(`result (${r.resultSource}):`);
        lines.push(r.result);
      } else if (r.error !== null) {
        lines.push("error:");
        lines.push(r.error);
      } else {
        lines.push("(no result available)");
      }
      return lines.join("\n");
    });

    return 0;
  } catch (err) {
    emitErr(`error: ${(err as Error).message}`);
    return 2;
  } finally {
    closeDb(db);
  }
}
