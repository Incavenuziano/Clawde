import type { CommandRunner } from "./command-runner.ts";
import { BunCommandRunner } from "./command-runner.ts";
import type { ActionLane, WarRoomCommand } from "./domain.ts";
import { classifyCommand, isGateExpired } from "./gates.ts";
import type { WarRoomStore } from "./store.ts";

export interface ExecuteWaveOptions {
  readonly roomId: string;
  readonly waveId: string;
  readonly dryRun: boolean;
  readonly confirm: boolean;
  readonly cwd: string;
  readonly store: WarRoomStore;
  readonly runner?: CommandRunner;
}

export interface ExecutedCommandResult {
  readonly commandId: string;
  readonly argv: ReadonlyArray<string>;
  readonly lane: ActionLane;
  readonly skipped: boolean;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly durationMs?: number;
  readonly detail?: string;
}

export interface ExecuteWaveResult {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly waveId: string;
  readonly commands: ReadonlyArray<ExecutedCommandResult>;
}

function normalizeCommand(command: WarRoomCommand): WarRoomCommand {
  return {
    ...command,
    lane: classifyCommand(command.argv),
  };
}

function hasApprovedGate(store: WarRoomStore, roomId: string, action: string): boolean {
  return store
    .readGates(roomId)
    .some(
      (gate) =>
        gate.action === action &&
        gate.status === "approved" &&
        !isGateExpired(gate.expiresAt, new Date()),
    );
}

export async function executeWave(options: ExecuteWaveOptions): Promise<ExecuteWaveResult> {
  const plan = options.store.readPlan(options.roomId);
  if (plan === null) throw new Error("war-room has no plan; run war-room plan first");
  const wave = plan.waves.find((w) => w.id === options.waveId);
  if (wave === undefined) throw new Error(`wave not found: ${options.waveId}`);

  const runner = options.runner ?? new BunCommandRunner();
  const results: ExecutedCommandResult[] = [];

  for (const raw of wave.commands.map(normalizeCommand)) {
    if (options.dryRun) {
      results.push({
        commandId: raw.id,
        argv: raw.argv,
        lane: raw.lane,
        skipped: true,
        detail: "dry-run",
      });
      continue;
    }

    if (raw.lane === "blocked") {
      options.store.addGate(options.roomId, {
        action: raw.argv.join(" "),
        reason: "blocked command requested during war-room execution",
      });
      results.push({
        commandId: raw.id,
        argv: raw.argv,
        lane: raw.lane,
        skipped: true,
        detail: "blocked command",
      });
      break;
    }

    if (
      raw.lane === "guarded" &&
      (!options.confirm || !hasApprovedGate(options.store, options.roomId, raw.argv.join(" ")))
    ) {
      options.store.addGate(options.roomId, {
        action: raw.argv.join(" "),
        reason: "guarded command requires explicit approval",
      });
      results.push({
        commandId: raw.id,
        argv: raw.argv,
        lane: raw.lane,
        skipped: true,
        detail: "gate required",
      });
      break;
    }

    if (raw.lane === "yellow" && !options.confirm) {
      results.push({
        commandId: raw.id,
        argv: raw.argv,
        lane: raw.lane,
        skipped: true,
        detail: "yellow command requires --confirm",
      });
      break;
    }

    const output = await runner.run({
      argv: raw.argv,
      cwd: raw.cwd ?? options.cwd,
      timeoutMs: raw.timeoutMs ?? 120_000,
    });
    const evidenceName = `command-${raw.id}.txt`;
    const evidencePath = options.store.writeEvidenceText(
      options.roomId,
      evidenceName,
      [
        `$ ${raw.argv.join(" ")}`,
        `exit=${output.exitCode} timed_out=${output.timedOut}`,
        "--- stdout ---",
        output.stdout,
        "--- stderr ---",
        output.stderr,
      ].join("\n"),
    );
    options.store.addEvidence(options.roomId, {
      name: evidenceName,
      path: evidencePath,
      status: output.exitCode === 0 && !output.timedOut ? "ok" : "error",
    });
    options.store.appendTimeline(options.roomId, {
      type: "command",
      message: `command ${raw.id} exit=${output.exitCode}`,
      payload: { argv: raw.argv, lane: raw.lane },
    });
    results.push({
      commandId: raw.id,
      argv: raw.argv,
      lane: raw.lane,
      skipped: false,
      exitCode: output.exitCode,
      timedOut: output.timedOut,
      durationMs: output.durationMs,
    });
    if (output.exitCode !== 0 || output.timedOut) break;
  }

  const ok = options.dryRun
    ? true
    : results.every(
        (result) => !result.skipped && result.exitCode === 0 && result.timedOut !== true,
      );
  return { ok, dryRun: options.dryRun, waveId: options.waveId, commands: results };
}
