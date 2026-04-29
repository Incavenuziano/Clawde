/**
 * Repository: sessions (state machine governada por SESSION_TRANSITIONS).
 */

import type { ClawdeDatabase } from "../client.ts";
import type { Session, SessionState } from "@clawde/domain/session";
import { validateSessionTransition } from "@clawde/state";

interface RawSessionRow {
  session_id: string;
  agent: string;
  state: SessionState;
  last_used_at: string | null;
  msg_count: number;
  token_estimate: number;
  created_at: string;
}

function rowToSession(r: RawSessionRow): Session {
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

export interface UpsertSessionInput {
  readonly sessionId: string;
  readonly agent: string;
}

export class SessionsRepo {
  constructor(private readonly db: ClawdeDatabase) {}

  /**
   * INSERT idempotente. Se session_id já existe, retorna a row atual sem alterar.
   */
  upsert(input: UpsertSessionInput): Session {
    this.db.run(
      `INSERT INTO sessions (session_id, agent, state)
       VALUES (?, ?, 'created')
       ON CONFLICT(session_id) DO NOTHING`,
      [input.sessionId, input.agent],
    );
    const found = this.findById(input.sessionId);
    if (found === null) {
      throw new Error(`upsert failed: session ${input.sessionId} not found after INSERT`);
    }
    return found;
  }

  findById(sessionId: string): Session | null {
    const row = this.db
      .query<RawSessionRow, [string]>("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId);
    return row === null ? null : rowToSession(row);
  }

  listByState(state: SessionState): ReadonlyArray<Session> {
    const rows = this.db
      .query<RawSessionRow, [SessionState]>(
        "SELECT * FROM sessions WHERE state = ? ORDER BY last_used_at DESC NULLS LAST",
      )
      .all(state);
    return rows.map(rowToSession);
  }

  /**
   * Transição validada. Lança InvalidTransitionError se transição inválida.
   */
  transitionState(sessionId: string, to: SessionState): Session {
    const current = this.findById(sessionId);
    if (current === null) {
      throw new Error(`session ${sessionId} not found`);
    }
    validateSessionTransition(current.state, to);
    this.db.run("UPDATE sessions SET state = ? WHERE session_id = ?", [to, sessionId]);
    const after = this.findById(sessionId);
    if (after === null) {
      throw new Error(`session ${sessionId} disappeared after UPDATE`);
    }
    return after;
  }

  /**
   * Marca sessão como usada agora: atualiza last_used_at + incrementa msg_count.
   * Não muda state (transição é responsabilidade do caller).
   */
  markUsed(sessionId: string, deltaMsgs = 1, deltaTokens = 0): Session {
    this.db.run(
      `UPDATE sessions
         SET last_used_at = datetime('now'),
             msg_count = msg_count + ?,
             token_estimate = token_estimate + ?
       WHERE session_id = ?`,
      [deltaMsgs, deltaTokens, sessionId],
    );
    const after = this.findById(sessionId);
    if (after === null) {
      throw new Error(`session ${sessionId} not found`);
    }
    return after;
  }
}
