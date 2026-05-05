import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  WarRoom,
  WarRoomEvidenceFile,
  WarRoomGate,
  WarRoomKind,
  WarRoomOutcome,
  WarRoomPlan,
  WarRoomTimelineEntry,
  WarRoomVerification,
} from "./domain.ts";
import {
  type WarRoomClock,
  makeGateId,
  makeTimelineEntryId,
  makeWarRoomId,
  systemWarRoomClock,
} from "./ids.ts";

export class WarRoomStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarRoomStoreError";
  }
}

export interface WarRoomStoreOptions {
  readonly root?: string;
  readonly home?: string;
  readonly clock?: WarRoomClock;
}

export interface OpenWarRoomInput {
  readonly kind: WarRoomKind;
  readonly title: string;
  readonly force?: boolean;
}

export interface CloseWarRoomInput {
  readonly outcome: WarRoomOutcome;
  readonly summary?: string;
  readonly force?: boolean;
}

export interface AddGateInput {
  readonly action: string;
  readonly reason: string;
  readonly expiresAt?: string;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function resolveWarRoomRoot(options: WarRoomStoreOptions = {}): string {
  if (options.root !== undefined && options.root.length > 0) {
    return resolve(expandHome(options.root));
  }
  const home =
    options.home ?? process.env.CLAWDE_HOME ?? join(process.env.HOME ?? homedir(), ".clawde");
  return resolve(expandHome(join(home, "state", "war-room")));
}

function readJsonFile<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (err) {
    throw new WarRoomStoreError(`failed to read ${path}: ${(err as Error).message}`);
  }
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf-8");
}

function readJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8").trim();
  if (raw.length === 0) return [];
  return raw.split("\n").map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (err) {
      throw new WarRoomStoreError(
        `failed to parse JSONL ${path}:${index + 1}: ${(err as Error).message}`,
      );
    }
  });
}

export class WarRoomStore {
  readonly root: string;
  private readonly clock: WarRoomClock;

  constructor(options: WarRoomStoreOptions = {}) {
    this.root = resolveWarRoomRoot(options);
    this.clock = options.clock ?? systemWarRoomClock;
  }

  roomDir(id: string): string {
    return join(this.root, "rooms", id);
  }

  activePath(): string {
    return join(this.root, "active.json");
  }

  ensureRoot(): void {
    mkdirSync(join(this.root, "rooms"), { recursive: true });
  }

  getActiveId(): string | null {
    const path = this.activePath();
    if (!existsSync(path)) return null;
    const data = readJsonFile<{ id?: string }>(path);
    return typeof data.id === "string" && data.id.length > 0 ? data.id : null;
  }

  getActiveRoom(): WarRoom | null {
    const id = this.getActiveId();
    return id === null ? null : this.getRoom(id);
  }

  getRoom(id: string): WarRoom {
    return readJsonFile<WarRoom>(join(this.roomDir(id), "room.json"));
  }

  listRooms(): ReadonlyArray<WarRoom> {
    const roomsRoot = join(this.root, "rooms");
    if (!existsSync(roomsRoot)) return [];
    return readdirSync(roomsRoot)
      .map((name) => join(roomsRoot, name, "room.json"))
      .filter((path) => existsSync(path))
      .map((path) => readJsonFile<WarRoom>(path))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  open(input: OpenWarRoomInput): WarRoom {
    this.ensureRoot();
    const active = this.getActiveRoom();
    if (active !== null && active.status === "active" && input.force !== true) {
      throw new WarRoomStoreError(`war room already active: ${active.id}`);
    }

    const now = this.clock.now();
    const datePrefix = `WR-${now.toISOString().slice(0, 10).replace(/-/g, "")}-`;
    const existing = this.listRooms().filter((room) => room.id.startsWith(datePrefix)).length;
    const room: WarRoom = {
      id: makeWarRoomId(now, existing + 1),
      kind: input.kind,
      title: input.title,
      status: "active",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    mkdirSync(join(this.roomDir(room.id), "evidence"), { recursive: true });
    writeJsonFile(join(this.roomDir(room.id), "room.json"), room);
    writeJsonFile(this.activePath(), { id: room.id });
    this.appendTimeline(room.id, {
      type: "open",
      message: `War room opened: ${room.title}`,
      payload: { kind: room.kind },
    });
    return room;
  }

  updateRoom(room: WarRoom): void {
    writeJsonFile(join(this.roomDir(room.id), "room.json"), {
      ...room,
      updatedAt: this.clock.now().toISOString(),
    });
  }

  appendTimeline(
    roomId: string,
    entry: Omit<WarRoomTimelineEntry, "id" | "ts">,
  ): WarRoomTimelineEntry {
    const now = this.clock.now();
    const timeline = this.readTimeline(roomId);
    const saved: WarRoomTimelineEntry = {
      id: makeTimelineEntryId(now, timeline.length + 1),
      ts: now.toISOString(),
      ...entry,
    };
    appendJsonLine(join(this.roomDir(roomId), "timeline.jsonl"), saved);
    return saved;
  }

  readTimeline(roomId: string): ReadonlyArray<WarRoomTimelineEntry> {
    return readJsonLines<WarRoomTimelineEntry>(join(this.roomDir(roomId), "timeline.jsonl"));
  }

  addEvidence(roomId: string, evidence: WarRoomEvidenceFile): void {
    appendJsonLine(join(this.roomDir(roomId), "evidence-index.jsonl"), evidence);
    this.appendTimeline(roomId, {
      type: "evidence",
      message: `evidence ${evidence.status}: ${evidence.name}`,
      payload: { path: evidence.path, detail: evidence.detail ?? null },
    });
  }

  readEvidence(roomId: string): ReadonlyArray<WarRoomEvidenceFile> {
    return readJsonLines<WarRoomEvidenceFile>(join(this.roomDir(roomId), "evidence-index.jsonl"));
  }

  evidencePath(roomId: string, name: string): string {
    return join(this.roomDir(roomId), "evidence", name);
  }

  writeEvidenceText(roomId: string, name: string, body: string): string {
    const path = this.evidencePath(roomId, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, "utf-8");
    return path;
  }

  addGate(roomId: string, input: AddGateInput): WarRoomGate {
    const now = this.clock.now();
    const gates = this.readGates(roomId);
    const gate: WarRoomGate = {
      id: makeGateId(now, gates.length + 1),
      action: input.action,
      lane: "guarded",
      reason: input.reason,
      status: "pending",
      createdAt: now.toISOString(),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };
    appendJsonLine(join(this.roomDir(roomId), "decisions.jsonl"), gate);
    this.appendTimeline(roomId, {
      type: "gate",
      message: `gate required: ${gate.action}`,
      payload: { gateId: gate.id, reason: gate.reason },
    });
    return gate;
  }

  readGates(roomId: string): ReadonlyArray<WarRoomGate> {
    return readJsonLines<WarRoomGate>(join(this.roomDir(roomId), "decisions.jsonl"));
  }

  approveGate(roomId: string, gateId: string, reason: string, decidedBy = "operator"): WarRoomGate {
    const gates = this.readGates(roomId);
    const gate = gates.find((g) => g.id === gateId);
    if (gate === undefined) throw new WarRoomStoreError(`gate not found: ${gateId}`);
    const now = this.clock.now().toISOString();
    const approved: WarRoomGate = {
      ...gate,
      status: "approved",
      decidedAt: now,
      decidedBy,
      decisionReason: reason,
    };
    const path = join(this.roomDir(roomId), "decisions.jsonl");
    writeFileSync(
      path,
      `${gates.map((g) => JSON.stringify(g.id === gateId ? approved : g)).join("\n")}\n`,
    );
    this.appendTimeline(roomId, {
      type: "gate",
      message: `gate approved: ${gate.action}`,
      payload: { gateId, reason },
    });
    return approved;
  }

  writePlan(roomId: string, plan: WarRoomPlan): void {
    writeJsonFile(join(this.roomDir(roomId), "plan.json"), plan);
    this.appendTimeline(roomId, {
      type: "note",
      message: `plan created from ${plan.sourcePath}`,
      payload: { waves: plan.waves.length },
    });
  }

  readPlan(roomId: string): WarRoomPlan | null {
    const path = join(this.roomDir(roomId), "plan.json");
    return existsSync(path) ? readJsonFile<WarRoomPlan>(path) : null;
  }

  writeVerification(roomId: string, verification: WarRoomVerification): void {
    writeJsonFile(join(this.roomDir(roomId), "verification.json"), verification);
    this.appendTimeline(roomId, {
      type: "verify",
      message: `verification ${verification.ok ? "passed" : "failed"}`,
      payload: { checks: verification.checks.length },
    });
    const room = this.getRoom(roomId);
    this.updateRoom({ ...room, lastVerifiedAt: verification.ts });
  }

  readVerification(roomId: string): WarRoomVerification | null {
    const path = join(this.roomDir(roomId), "verification.json");
    return existsSync(path) ? readJsonFile<WarRoomVerification>(path) : null;
  }

  writeReport(roomId: string, body: string, name = "report.md"): string {
    const path = join(this.roomDir(roomId), name);
    writeFileSync(path, body, "utf-8");
    this.appendTimeline(roomId, {
      type: "report",
      message: `report written: ${name}`,
      payload: { path },
    });
    return path;
  }

  close(roomId: string, input: CloseWarRoomInput): WarRoom {
    const verification = this.readVerification(roomId);
    if (verification === null && input.force !== true) {
      throw new WarRoomStoreError("war-room close requires verification or --force --reason");
    }
    const now = this.clock.now().toISOString();
    const room = this.getRoom(roomId);
    const closed: WarRoom = {
      ...room,
      status: "closed",
      outcome: input.outcome,
      closedAt: now,
      updatedAt: now,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
    };
    writeJsonFile(join(this.roomDir(roomId), "room.json"), closed);
    if (this.getActiveId() === roomId) {
      rmSync(this.activePath(), { force: true });
    }
    this.appendTimeline(roomId, {
      type: "close",
      message: `War room closed: ${input.outcome}`,
      payload: { summary: input.summary ?? null },
    });
    return closed;
  }
}
