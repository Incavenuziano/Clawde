/**
 * Repository: quota_ledger (sliding window 5h, ARCHITECTURE §6.6).
 */

import type { NewQuotaLedgerEntry, Plan, QuotaLedgerEntry } from "@clawde/domain/quota";
import type { ClawdeDatabase } from "../client.ts";

interface RawLedgerRow {
  id: number;
  ts: string;
  msgs_consumed: number;
  window_start: string;
  plan: Plan;
  peak_multiplier: number;
  task_run_id: number | null;
}

function rowToEntry(r: RawLedgerRow): QuotaLedgerEntry {
  return {
    id: r.id,
    ts: r.ts,
    msgsConsumed: r.msgs_consumed,
    windowStart: r.window_start,
    plan: r.plan,
    peakMultiplier: r.peak_multiplier,
    taskRunId: r.task_run_id,
  };
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

/**
 * Arredonda timestamp pra hora cheia UTC (precisão suficiente, evita drift).
 */
export function roundToHour(date: Date): string {
  const rounded = new Date(date);
  rounded.setUTCMinutes(0, 0, 0);
  return rounded.toISOString().replace("T", " ").replace(/\..+$/, "");
}

export class QuotaLedgerRepo {
  constructor(private readonly db: ClawdeDatabase) {}

  insert(input: NewQuotaLedgerEntry): QuotaLedgerEntry {
    const row = this.db
      .query<RawLedgerRow, [number, string, Plan, number, number | null]>(
        `INSERT INTO quota_ledger
           (msgs_consumed, window_start, plan, peak_multiplier, task_run_id)
         VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.msgsConsumed,
        input.windowStart,
        input.plan,
        input.peakMultiplier,
        input.taskRunId,
      );
    if (row === null) {
      throw new Error("INSERT...RETURNING returned null");
    }
    return rowToEntry(row);
  }

  /**
   * Soma de msgs_consumed na janela ativa (window_start ≥ now-5h).
   */
  totalInWindow(now: Date = new Date()): number {
    const cutoff = roundToHour(new Date(now.getTime() - FIVE_HOURS_MS));
    const row = this.db
      .query<{ total: number | null }, [string]>(
        "SELECT SUM(msgs_consumed) AS total FROM quota_ledger WHERE window_start >= ?",
      )
      .get(cutoff);
    return row?.total ?? 0;
  }

  /**
   * window_start canônico para timestamp atual (rounded to hour, in UTC).
   */
  currentWindowStart(now: Date = new Date()): string {
    return roundToHour(now);
  }

  /**
   * Lista as N últimas entries (mais recentes primeiro).
   */
  findRecent(limit = 100): ReadonlyArray<QuotaLedgerEntry> {
    const rows = this.db
      .query<RawLedgerRow, [number]>("SELECT * FROM quota_ledger ORDER BY ts DESC, id DESC LIMIT ?")
      .all(limit);
    return rows.map(rowToEntry);
  }
}
