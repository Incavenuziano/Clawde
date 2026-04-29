/**
 * Session = sessão Claude continuada via --session-id ou --resume.
 * State machine (ARCHITECTURE §9.8 / ADR 0011): created → active → idle → stale →
 * compact_pending → archived.
 */

import { uuidV5 } from "./uuid.ts";

export const SESSION_STATE_VALUES = [
  "created",
  "active",
  "idle",
  "stale",
  "compact_pending",
  "archived",
] as const;
export type SessionState = (typeof SESSION_STATE_VALUES)[number];

export interface Session {
  readonly sessionId: string;
  readonly agent: string;
  readonly state: SessionState;
  readonly lastUsedAt: string | null;
  readonly msgCount: number;
  readonly tokenEstimate: number;
  readonly createdAt: string;
}

export const SESSION_TRANSITIONS: Readonly<Record<SessionState, ReadonlyArray<SessionState>>> = {
  created: ["active"],
  active: ["idle"],
  idle: ["active", "stale"],
  stale: ["compact_pending", "archived"],
  compact_pending: ["active", "archived"],
  archived: [],
};

export interface DeriveSessionIdInput {
  readonly agent: string;
  readonly workingDir: string;
  readonly intent?: string;
}

/**
 * Gera session ID determinístico a partir de (agent, workingDir, [intent]).
 * Mesma entrada → mesmo UUID. Permite reusar sessão entre invocações sem
 * persistir mapeamentos.
 */
export function deriveSessionId(input: DeriveSessionIdInput): string {
  const parts = [input.agent, input.workingDir];
  if (input.intent !== undefined) {
    parts.push(input.intent);
  }
  return uuidV5(parts.join("|"));
}
