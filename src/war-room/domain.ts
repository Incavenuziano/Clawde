export const WAR_ROOM_KINDS = ["incident", "hardening", "release", "ops"] as const;
export type WarRoomKind = (typeof WAR_ROOM_KINDS)[number];

export const WAR_ROOM_STATUSES = ["active", "closed"] as const;
export type WarRoomStatus = (typeof WAR_ROOM_STATUSES)[number];

export const WAR_ROOM_OUTCOMES = ["resolved", "mitigated", "aborted", "superseded"] as const;
export type WarRoomOutcome = (typeof WAR_ROOM_OUTCOMES)[number];

export const ACTION_LANES = ["green", "yellow", "guarded", "blocked"] as const;
export type ActionLane = (typeof ACTION_LANES)[number];

export const GATE_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export interface WarRoom {
  readonly id: string;
  readonly kind: WarRoomKind;
  readonly title: string;
  readonly status: WarRoomStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
  readonly outcome?: WarRoomOutcome;
  readonly summary?: string;
  readonly lastVerifiedAt?: string;
}

export type TimelineEntryType =
  | "note"
  | "evidence"
  | "gate"
  | "command"
  | "verify"
  | "report"
  | "open"
  | "close";

export interface WarRoomTimelineEntry {
  readonly id: string;
  readonly ts: string;
  readonly type: TimelineEntryType;
  readonly message: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface WarRoomEvidenceFile {
  readonly name: string;
  readonly path: string;
  readonly status: "ok" | "warn" | "error";
  readonly detail?: string;
}

export interface WarRoomGate {
  readonly id: string;
  readonly action: string;
  readonly lane: Exclude<ActionLane, "green">;
  readonly reason: string;
  readonly status: GateStatus;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decisionReason?: string;
}

export interface WarRoomCommand {
  readonly id: string;
  readonly argv: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly lane: ActionLane;
  readonly description?: string;
  readonly timeoutMs?: number;
}

export interface WarRoomWave {
  readonly id: string;
  readonly title: string;
  readonly commands: ReadonlyArray<WarRoomCommand>;
  readonly checks: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
}

export interface WarRoomPlan {
  readonly sourcePath: string;
  readonly createdAt: string;
  readonly waves: ReadonlyArray<WarRoomWave>;
  readonly notes: ReadonlyArray<string>;
}

export interface WarRoomVerification {
  readonly ts: string;
  readonly ok: boolean;
  readonly checks: ReadonlyArray<{
    readonly name: string;
    readonly ok: boolean;
    readonly detail?: string;
  }>;
}

export function isWarRoomKind(value: string): value is WarRoomKind {
  return (WAR_ROOM_KINDS as ReadonlyArray<string>).includes(value);
}

export function isWarRoomOutcome(value: string): value is WarRoomOutcome {
  return (WAR_ROOM_OUTCOMES as ReadonlyArray<string>).includes(value);
}
