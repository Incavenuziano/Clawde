/**
 * `clawde sessions list|show <id>` — visibility sobre estado das sessões
 * persistentes do SDK. Sub-fase P3.2 (T-107, T-108).
 */

import type { Session, SessionState } from "@clawde/domain/session";
import { closeDb, openDb } from "@clawde/db/client";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface SessionsListOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  readonly limit?: number;
}

export interface SessionsShowOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  readonly sessionId: string;
  readonly nowMs?: () => number;
}

interface SessionRow {
  readonly session_id: string;
  readonly agent: string;
  readonly state: SessionState;
  readonly last_used_at: string | null;
  readonly msg_count: number;
  readonly token_estimate: number;
  readonly created_at: string;
}

function rowToSession(r: SessionRow): Session {
  return {
    sessionId: r.session_id,
    agent: r.agent,
    state: r.state,
    lastUsedAt: r.last_used_at,
    msgCount: r.msg_count,
    tokenEstimate: r.token_estimate,
    createdAt: r.created_at,
  };
}

export function runSessionsList(options: SessionsListOptions): number {
  const limit = options.limit ?? 100;
  try {
    const db = openDb(options.dbPath);
    try {
      const rows = db
        .query<SessionRow, [number]>(
          `SELECT session_id, agent, state, last_used_at, msg_count, token_estimate, created_at
           FROM sessions
           ORDER BY last_used_at DESC NULLS LAST, created_at DESC
           LIMIT ?`,
        )
        .all(limit);
      const sessions = rows.map(rowToSession);
      emit(options.format, sessions, (d) => {
        const list = d as ReadonlyArray<Session>;
        if (list.length === 0) return "(no sessions)";
        const header =
          "session_id                            agent             state             last_used_at         msgs   tokens";
        const lines = list.map((s) => {
          const id = s.sessionId.padEnd(36);
          const agent = (s.agent ?? "").padEnd(17);
          const state = s.state.padEnd(17);
          const last = (s.lastUsedAt ?? "—").padEnd(20);
          const msgs = String(s.msgCount).padStart(5);
          const toks = String(s.tokenEstimate).padStart(8);
          return `${id} ${agent} ${state} ${last} ${msgs} ${toks}`;
        });
        return [header, ...lines].join("\n");
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

export interface SessionShowReport {
  readonly session: Session;
  readonly eventsCount: number;
  readonly warnings: ReadonlyArray<string>;
}

export function runSessionsShow(options: SessionsShowOptions): number {
  try {
    const db = openDb(options.dbPath);
    try {
      const row = db
        .query<SessionRow, [string]>(
          `SELECT session_id, agent, state, last_used_at, msg_count, token_estimate, created_at
           FROM sessions WHERE session_id = ?`,
        )
        .get(options.sessionId);
      if (row === null) {
        emitErr(`error: session ${options.sessionId} not found`);
        return 1;
      }
      const session = rowToSession(row);
      const eventsRow = db
        .query<{ n: number }, [string]>(
          `SELECT COUNT(*) AS n FROM events WHERE session_id = ?`,
        )
        .get(options.sessionId);
      const eventsCount = eventsRow?.n ?? 0;
      const warnings: string[] = [];
      if (
        session.state === "compact_pending" &&
        session.lastUsedAt !== null &&
        ageDays(session.lastUsedAt, options.nowMs?.() ?? Date.now()) > 7
      ) {
        warnings.push(
          `state=compact_pending há mais de 7 dias (last_used_at=${session.lastUsedAt})`,
        );
      }

      const report: SessionShowReport = { session, eventsCount, warnings };
      emit(options.format, report, (d) => {
        const r = d as SessionShowReport;
        const lines = [
          `session_id:     ${r.session.sessionId}`,
          `agent:          ${r.session.agent}`,
          `state:          ${r.session.state}`,
          `created_at:     ${r.session.createdAt}`,
          `last_used_at:   ${r.session.lastUsedAt ?? "(never)"}`,
          `msg_count:      ${r.session.msgCount}`,
          `token_estimate: ${r.session.tokenEstimate}`,
          `events_count:   ${r.eventsCount}`,
        ];
        if (r.warnings.length > 0) {
          lines.push("");
          for (const w of r.warnings) lines.push(`WARNING: ${w}`);
        }
        return lines.join("\n");
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

function ageDays(isoTimestamp: string, nowMs: number): number {
  const then = Date.parse(isoTimestamp.replace(" ", "T") + (isoTimestamp.includes("Z") ? "" : "Z"));
  if (Number.isNaN(then)) return 0;
  return (nowMs - then) / (24 * 60 * 60 * 1000);
}
