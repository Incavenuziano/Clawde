import { existsSync } from "node:fs";
import {
  WAR_ROOM_KINDS,
  WAR_ROOM_OUTCOMES,
  WarRoomStore,
  buildWarRoomPlan,
  buildWarRoomReport,
  executeWave,
  isWarRoomKind,
  isWarRoomOutcome,
  verifyWarRoom,
} from "@clawde/war-room";
import { defaultCollectors } from "@clawde/war-room/collectors";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface WarRoomCommandOptions {
  readonly action: string;
  readonly positional: ReadonlyArray<string>;
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly format: OutputFormat;
  readonly dbPath: string;
  readonly cwd?: string;
}

function flag(flags: Readonly<Record<string, string | boolean>>, name: string): string | undefined {
  const value = flags[name];
  if (typeof value === "string") return value;
  if (value === true) return "";
  return undefined;
}

function boolFlag(flags: Readonly<Record<string, string | boolean>>, name: string): boolean {
  return flags[name] === true;
}

function makeStore(options: WarRoomCommandOptions): WarRoomStore {
  const root = flag(options.flags, "war-room-root");
  return new WarRoomStore(root !== undefined && root.length > 0 ? { root } : {});
}

function requireActiveRoom(store: WarRoomStore, roomId?: string): string {
  if (roomId !== undefined && roomId.length > 0) return roomId;
  const activeId = store.getActiveId();
  if (activeId === null) {
    throw new Error("no active war room; run clawde war-room open first or pass --room <id>");
  }
  return activeId;
}

function renderStatus(data: unknown): string {
  const report = data as ReturnType<typeof buildStatusPayload>;
  const room = report.room;
  const lines = [
    `war-room: ${room.id}`,
    `title:    ${room.title}`,
    `kind:     ${room.kind}`,
    `status:   ${room.status}`,
    `created:  ${room.createdAt}`,
    `timeline:${report.timelineCount}`,
    `evidence:${report.evidenceCount}`,
    `gates:    ${report.pendingGates} pending / ${report.gateCount} total`,
  ];
  if (room.lastVerifiedAt !== undefined) lines.push(`verified:${room.lastVerifiedAt}`);
  return lines.join("\n");
}

function buildStatusPayload(store: WarRoomStore, roomId: string) {
  const room = store.getRoom(roomId);
  const gates = store.readGates(roomId);
  return {
    room,
    timelineCount: store.readTimeline(roomId).length,
    evidenceCount: store.readEvidence(roomId).length,
    gateCount: gates.length,
    pendingGates: gates.filter((gate) => gate.status === "pending").length,
    verification: store.readVerification(roomId),
  };
}

async function runCollect(options: WarRoomCommandOptions, store: WarRoomStore): Promise<number> {
  const roomId = requireActiveRoom(store, flag(options.flags, "room"));
  const cwd = options.cwd ?? process.cwd();
  const selected = new Set<string>();
  for (const name of ["git", "db", "diagnose", "systemd", "github", "logs"]) {
    if (boolFlag(options.flags, name)) selected.add(name);
  }
  const all = boolFlag(options.flags, "all") || selected.size === 0;
  const collectors = defaultCollectors().filter((collector) => all || selected.has(collector.name));
  const results = [];
  for (const collector of collectors) {
    try {
      results.push(await collector.collect({ roomId, store, cwd, dbPath: options.dbPath }));
    } catch (err) {
      const path = store.writeEvidenceText(
        roomId,
        `${collector.name}-error.txt`,
        (err as Error).message,
      );
      store.addEvidence(roomId, {
        name: collector.name,
        path,
        status: "error",
        detail: (err as Error).message,
      });
      results.push({ name: collector.name, status: "error", path, detail: (err as Error).message });
    }
  }
  emit(options.format, { roomId, results }, (d) => {
    const data = d as { results: Array<{ name: string; status: string; detail?: string }> };
    return data.results
      .map(
        (result) =>
          `[${result.status.toUpperCase()}] ${result.name}${result.detail ? `: ${result.detail}` : ""}`,
      )
      .join("\n");
  });
  return results.length > 0 && results.every((result) => result.status === "error") ? 2 : 0;
}

export async function runWarRoom(options: WarRoomCommandOptions): Promise<number> {
  const store = makeStore(options);
  const action = options.action;

  try {
    if (action === "open") {
      const rawKind = flag(options.flags, "kind") ?? "ops";
      if (!isWarRoomKind(rawKind)) {
        emitErr(`invalid --kind '${rawKind}' (use ${WAR_ROOM_KINDS.join("|")})`);
        return 1;
      }
      const title = flag(options.flags, "title") ?? options.positional.join(" ");
      if (title.length === 0) {
        emitErr("error: war-room open requires --title <text> or positional title");
        return 1;
      }
      const room = store.open({ kind: rawKind, title, force: boolFlag(options.flags, "force") });
      emit(options.format, room, (d) => `opened war-room ${(d as { id: string }).id}`);
      return 0;
    }

    if (action === "status") {
      const roomId = requireActiveRoom(store, flag(options.flags, "room"));
      const payload = buildStatusPayload(store, roomId);
      emit(options.format, payload, renderStatus);
      return 0;
    }

    if (action === "note") {
      const roomId = requireActiveRoom(store, flag(options.flags, "room"));
      const message = options.positional.join(" ");
      if (message.length === 0) {
        emitErr("error: war-room note requires text");
        return 1;
      }
      const entry = store.appendTimeline(roomId, { type: "note", message });
      emit(options.format, entry, (d) => `noted ${(d as { id: string }).id}`);
      return 0;
    }

    if (action === "collect") {
      return await runCollect(options, store);
    }

    if (action === "plan") {
      const roomId = requireActiveRoom(store, flag(options.flags, "room"));
      const source = flag(options.flags, "from") ?? options.positional[0];
      if (source === undefined || source.length === 0) {
        emitErr("error: war-room plan requires --from <file>");
        return 1;
      }
      if (!existsSync(source)) {
        emitErr(`error: plan source not found: ${source}`);
        return 1;
      }
      const plan = buildWarRoomPlan({ sourcePath: source });
      store.writePlan(roomId, plan);
      emit(options.format, plan, (d) => {
        const p = d as { sourcePath: string; waves: ReadonlyArray<unknown> };
        return `planned ${p.waves.length} wave(s) from ${p.sourcePath}`;
      });
      return 0;
    }

    if (action === "execute") {
      const roomId = requireActiveRoom(store, flag(options.flags, "room"));
      const waveId = flag(options.flags, "wave") ?? options.positional[0] ?? "wave-1";
      const result = await executeWave({
        roomId,
        waveId,
        dryRun: boolFlag(options.flags, "dry-run"),
        confirm: boolFlag(options.flags, "confirm"),
        cwd: options.cwd ?? process.cwd(),
        store,
      });
      emit(options.format, result, (d) => {
        const r = d as typeof result;
        return [
          `wave ${r.waveId}: ${r.ok ? "OK" : "STOPPED"}`,
          ...r.commands.map((cmd) => {
            const state = cmd.skipped ? "skip" : `exit=${cmd.exitCode ?? "?"}`;
            return `  [${cmd.lane}] ${cmd.argv.join(" ")} (${state})`;
          }),
        ].join("\n");
      });
      return result.ok ? 0 : 2;
    }

    if (action === "verify") {
      const roomId = requireActiveRoom(store, flag(options.flags, "room"));
      const verification = await verifyWarRoom({
        cwd: options.cwd ?? process.cwd(),
        dbPath: options.dbPath,
        ci: boolFlag(options.flags, "ci"),
        smoke: boolFlag(options.flags, "smoke"),
        diagnose: boolFlag(options.flags, "diagnose"),
      });
      store.writeVerification(roomId, verification);
      emit(options.format, verification, (d) => {
        const v = d as typeof verification;
        return [
          `verification: ${v.ok ? "OK" : "FAIL"}`,
          ...v.checks.map((c) => `  [${c.ok ? "OK" : "FAIL"}] ${c.name}: ${c.detail ?? ""}`),
        ].join("\n");
      });
      return verification.ok ? 0 : 2;
    }

    if (action === "gate") {
      const sub = options.positional[0] ?? "list";
      const roomId = requireActiveRoom(store, flag(options.flags, "room"));
      if (sub === "list") {
        const gates = store.readGates(roomId);
        emit(options.format, { roomId, gates }, (d) => {
          const data = d as {
            gates: ReadonlyArray<{ id: string; status: string; action: string }>;
          };
          return data.gates.length === 0
            ? "(no gates)"
            : data.gates.map((gate) => `${gate.id} ${gate.status} ${gate.action}`).join("\n");
        });
        return 0;
      }
      if (sub === "approve") {
        const gateId = options.positional[1];
        const reason = flag(options.flags, "reason") ?? options.positional.slice(2).join(" ");
        if (gateId === undefined || gateId.length === 0 || reason.length === 0) {
          emitErr("error: war-room gate approve requires <gate-id> --reason <text>");
          return 1;
        }
        const gate = store.approveGate(roomId, gateId, reason);
        emit(options.format, gate, (d) => `approved ${(d as { id: string }).id}`);
        return 0;
      }
      emitErr("unknown war-room gate action: use list|approve");
      return 1;
    }

    if (action === "report") {
      const roomId = requireActiveRoom(store, flag(options.flags, "room"));
      const body = buildWarRoomReport(store, roomId);
      const path = store.writeReport(roomId, body);
      if (options.format === "json") {
        emit("json", { roomId, path, body });
      } else {
        emit("text", body);
      }
      return 0;
    }

    if (action === "close") {
      const roomId = requireActiveRoom(store, flag(options.flags, "room"));
      const rawOutcome = flag(options.flags, "outcome") ?? options.positional[0] ?? "resolved";
      if (!isWarRoomOutcome(rawOutcome)) {
        emitErr(`invalid --outcome '${rawOutcome}' (use ${WAR_ROOM_OUTCOMES.join("|")})`);
        return 1;
      }
      const summary = flag(options.flags, "summary") ?? flag(options.flags, "reason");
      const force = boolFlag(options.flags, "force");
      if (force && (summary === undefined || summary.length === 0)) {
        emitErr("error: --force close requires --reason <text> or --summary <text>");
        return 1;
      }
      const closeInput = {
        outcome: rawOutcome,
        force,
        ...(summary !== undefined ? { summary } : {}),
      };
      const room = store.close(roomId, closeInput);
      emit(options.format, room, (d) => `closed war-room ${(d as { id: string }).id}`);
      return 0;
    }
  } catch (err) {
    emitErr(`error: ${(err as Error).message}`);
    return 2;
  }

  emitErr(
    "unknown war-room action: use open|status|note|collect|plan|execute|verify|gate|report|close",
  );
  return 1;
}
