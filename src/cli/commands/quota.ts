/**
 * `clawde quota status|history` — estado da janela ativa + histórico recente.
 */

import { closeDb, openDb } from "@clawde/db/client";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker } from "@clawde/quota";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface QuotaCmdOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  readonly action: "status" | "history";
  readonly historyLimit?: number;
}

export function runQuota(options: QuotaCmdOptions): number {
  try {
    const db = openDb(options.dbPath);
    const repo = new QuotaLedgerRepo(db);
    const tracker = new QuotaTracker(repo, DEFAULT_TRACKER_CONFIG);

    try {
      if (options.action === "status") {
        const window = tracker.currentWindow();
        emit(options.format, window, (d) => {
          const w = d as ReturnType<typeof tracker.currentWindow>;
          const lines = [
            `state:        ${w.state}`,
            `plan:         ${w.plan}`,
            `consumed:     ${w.msgsConsumed} msgs`,
            `window_start: ${w.windowStart}`,
            `resets_at:    ${w.resetsAt}`,
          ];
          return lines.join("\n");
        });
        return 0;
      }
      // history
      const limit = options.historyLimit ?? 30;
      const recent = repo.findRecent(limit);
      emit(options.format, recent, (d) => {
        const list = d as ReadonlyArray<{
          ts: string;
          msgsConsumed: number;
          windowStart: string;
          peakMultiplier: number;
        }>;
        if (list.length === 0) return "(no quota history)";
        return list
          .map(
            (e) =>
              `${e.ts} window=${e.windowStart} msgs=${e.msgsConsumed} peak=${e.peakMultiplier}x`,
          )
          .join("\n");
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
