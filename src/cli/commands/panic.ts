/**
 * `clawde panic-stop` / `panic-resume` — gate operacional pra travar/destravar
 * o daemon. Idempotente. Lock file persistente em `<clawde.home>/panic.lock`
 * sinaliza estado pro `panic-resume` e pra outros operadores.
 *
 * Sub-fase P3.2 (T-104, T-105). Spec em EXECUTION_BACKLOG.md §P3.2.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { closeDb, openDb } from "@clawde/db/client";
import { EventsRepo } from "@clawde/db/repositories/events";
import { type OutputFormat, emit, emitErr } from "../output.ts";
import { type DiagnoseReport, runDiagnose } from "./diagnose.ts";

export interface PanicLockInfo {
  readonly ts: string;
  readonly hostname: string;
  readonly pid: number;
  readonly reason?: string;
}

/**
 * Cria lock file em `lockPath`. Idempotente: se já existir, retorna o info
 * preexistente sem sobrescrever (preserva quem trancou primeiro).
 *
 * Não cria diretórios pais? Cria — falha menos friendly se `<clawde.home>`
 * não existir.
 */
export function createPanicLock(lockPath: string, reason?: string): PanicLockInfo {
  if (existsSync(lockPath)) {
    return readPanicLock(lockPath);
  }
  mkdirSync(dirname(lockPath), { recursive: true });
  const info: PanicLockInfo = {
    ts: new Date().toISOString(),
    hostname: hostnameSafe(),
    pid: process.pid,
    ...(reason !== undefined ? { reason } : {}),
  };
  writeFileSync(lockPath, JSON.stringify(info, null, 2), "utf-8");
  return info;
}

export function panicLockExists(lockPath: string): boolean {
  return existsSync(lockPath);
}

/**
 * Lê info do lock. Throw se ausente — caller deve checar `panicLockExists`
 * primeiro se quiser tolerância.
 */
export function readPanicLock(lockPath: string): PanicLockInfo {
  const raw = readFileSync(lockPath, "utf-8");
  return JSON.parse(raw) as PanicLockInfo;
}

/**
 * Remove lock file. Idempotente: no-op se já ausente.
 */
export function removePanicLock(lockPath: string): void {
  if (!existsSync(lockPath)) return;
  rmSync(lockPath, { force: true });
}

function hostnameSafe(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("node:os") as typeof import("node:os");
    return os.hostname();
  } catch {
    return "unknown";
  }
}

/**
 * Wrapper injetável pra systemctl --user. Real chama subprocess; fake usado
 * em testes pra inspecionar chamadas sem precisar de systemd.
 */
export interface SystemdController {
  stop(unit: string): Promise<SystemdResult>;
  start(unit: string): Promise<SystemdResult>;
  isActive(unit: string): Promise<boolean>;
}

export interface SystemdResult {
  readonly ok: boolean;
  readonly detail?: string;
}

export interface SystemdCall {
  readonly op: "stop" | "start" | "isActive";
  readonly unit: string;
}

export function realSystemdController(): SystemdController {
  return {
    async stop(unit) {
      return runSystemctl(["--user", "stop", unit]);
    },
    async start(unit) {
      return runSystemctl(["--user", "start", unit]);
    },
    async isActive(unit) {
      const result = await runSystemctl(["--user", "is-active", unit]);
      return result.ok;
    },
  };
}

export interface FakeSystemdController extends SystemdController {
  readonly calls: ReadonlyArray<SystemdCall>;
  setActive(unit: string, active: boolean): void;
  failOn(op: SystemdCall["op"], unit: string, detail?: string): void;
}

export function fakeSystemdController(): FakeSystemdController {
  const calls: SystemdCall[] = [];
  const active = new Map<string, boolean>();
  const fails = new Map<string, { op: SystemdCall["op"]; detail?: string }>();
  const failKey = (op: SystemdCall["op"], unit: string): string => `${op}:${unit}`;

  return {
    get calls() {
      return calls;
    },
    setActive(unit, isActive) {
      active.set(unit, isActive);
    },
    failOn(op, unit, detail) {
      fails.set(failKey(op, unit), { op, ...(detail !== undefined ? { detail } : {}) });
    },
    async stop(unit) {
      calls.push({ op: "stop", unit });
      const fail = fails.get(failKey("stop", unit));
      if (fail !== undefined)
        return { ok: false, ...(fail.detail !== undefined ? { detail: fail.detail } : {}) };
      active.set(unit, false);
      return { ok: true };
    },
    async start(unit) {
      calls.push({ op: "start", unit });
      const fail = fails.get(failKey("start", unit));
      if (fail !== undefined)
        return { ok: false, ...(fail.detail !== undefined ? { detail: fail.detail } : {}) };
      active.set(unit, true);
      return { ok: true };
    },
    async isActive(unit) {
      calls.push({ op: "isActive", unit });
      return active.get(unit) ?? false;
    },
  };
}

/**
 * `clawde panic-stop` — para receiver+worker, registra event panic_stop,
 * cria lock pra travar panic-resume sem diagnose ok. Idempotente per
 * BLUEPRINT §6.2.
 */
export interface PanicStopOptions {
  readonly dbPath: string;
  readonly lockPath: string;
  readonly format: OutputFormat;
  readonly reason?: string;
  readonly systemd?: SystemdController;
}

export interface PanicStopReport {
  readonly ok: boolean;
  readonly alreadyLocked: boolean;
  readonly lock: PanicLockInfo;
  readonly stops: ReadonlyArray<{ unit: string; ok: boolean; detail?: string }>;
}

export async function runPanicStop(options: PanicStopOptions): Promise<number> {
  const sd = options.systemd ?? realSystemdController();
  const alreadyLocked = panicLockExists(options.lockPath);
  const lock = createPanicLock(options.lockPath, options.reason);

  const units = ["clawde-receiver", "clawde-worker.path"];
  const stops: Array<{ unit: string; ok: boolean; detail?: string }> = [];
  for (const unit of units) {
    const r = await sd.stop(unit);
    stops.push({
      unit,
      ok: r.ok,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    });
  }

  let dbOk = true;
  try {
    const db = openDb(options.dbPath);
    try {
      const events = new EventsRepo(db);
      events.insert({
        taskRunId: null,
        sessionId: null,
        traceId: null,
        spanId: null,
        kind: "panic_stop",
        payload: {
          lock_ts: lock.ts,
          hostname: lock.hostname,
          pid: lock.pid,
          reason: lock.reason ?? null,
          already_locked: alreadyLocked,
          stops: stops.map((s) => ({ unit: s.unit, ok: s.ok })),
        },
      });
    } finally {
      closeDb(db);
    }
  } catch (err) {
    dbOk = false;
    emitErr(`warning: failed to persist panic_stop event: ${(err as Error).message}`);
  }

  const allStopsOk = stops.every((s) => s.ok);
  const report: PanicStopReport = {
    ok: allStopsOk && dbOk,
    alreadyLocked,
    lock,
    stops,
  };

  emit(options.format, report, (d) => {
    const r = d as PanicStopReport;
    const lines = [
      `lock:         ${r.lock.ts} (${r.alreadyLocked ? "preexisting" : "new"})`,
      `host/pid:     ${r.lock.hostname}/${r.lock.pid}`,
      ...(r.lock.reason !== undefined ? [`reason:       ${r.lock.reason}`] : []),
      ...r.stops.map(
        (s) =>
          `[${s.ok ? "OK " : "FAIL"}] systemctl stop ${s.unit}${s.detail !== undefined ? `: ${s.detail}` : ""}`,
      ),
      `overall: ${r.ok ? "OK" : "DEGRADED"}`,
    ];
    return lines.join("\n");
  });

  return 0;
}

/**
 * `clawde panic-resume` — destrava após panic-stop. Pré-requisito: `clawde
 * diagnose all` retorna status=ok (sem warnings, sem errors). Se warn ou
 * error, recusa resume e mantém lock (exit 1). Per spec T-105.
 *
 * Happy path (exit 0): remove lock + systemctl start clawde-receiver.
 * Falha de start retorna exit 2 (lock já removido — estado conhecido pra
 * operador investigar; resume não é idempotente por design).
 */
export interface PanicResumeOptions {
  readonly dbPath: string;
  readonly lockPath: string;
  readonly format: OutputFormat;
  readonly systemd?: SystemdController;
  readonly diagnose?: () => Promise<DiagnoseReport>;
  readonly agentsRoot?: string;
}

export interface PanicResumeReport {
  readonly ok: boolean;
  readonly diagnose: DiagnoseReport;
  readonly start?: { unit: string; ok: boolean; detail?: string };
  readonly lockRemoved: boolean;
  readonly refusedReason?: string;
}

export async function runPanicResume(options: PanicResumeOptions): Promise<number> {
  const sd = options.systemd ?? realSystemdController();
  const diagnose =
    options.diagnose ?? (async () => captureDiagnoseAll(options.dbPath, options.agentsRoot));
  const diagnoseReport = await diagnose();

  if (diagnoseReport.status !== "ok") {
    const refusedReason = `diagnose status=${diagnoseReport.status}; resume refused`;
    const report: PanicResumeReport = {
      ok: false,
      diagnose: diagnoseReport,
      lockRemoved: false,
      refusedReason,
    };
    emitResume(options.format, report);
    return 1;
  }

  removePanicLock(options.lockPath);
  const lockRemoved = !panicLockExists(options.lockPath);

  const startResult = await sd.start("clawde-receiver");
  const start: { unit: string; ok: boolean; detail?: string } = {
    unit: "clawde-receiver",
    ok: startResult.ok,
    ...(startResult.detail !== undefined ? { detail: startResult.detail } : {}),
  };

  const report: PanicResumeReport = {
    ok: startResult.ok && lockRemoved,
    diagnose: diagnoseReport,
    start,
    lockRemoved,
  };
  emitResume(options.format, report);
  return report.ok ? 0 : 2;
}

function emitResume(format: OutputFormat, report: PanicResumeReport): void {
  emit(format, report, (d) => {
    const r = d as PanicResumeReport;
    const lines: string[] = [];
    lines.push(`diagnose: ${r.diagnose.status} (${r.diagnose.checks.length} checks)`);
    for (const c of r.diagnose.checks) {
      lines.push(`  [${c.status}] ${c.name}: ${c.detail ?? ""}`);
    }
    if (r.refusedReason !== undefined) {
      lines.push(`refused: ${r.refusedReason}`);
      return lines.join("\n");
    }
    if (r.start !== undefined) {
      lines.push(
        `[${r.start.ok ? "OK " : "FAIL"}] systemctl start ${r.start.unit}${r.start.detail !== undefined ? `: ${r.start.detail}` : ""}`,
      );
    }
    lines.push(`lock removed: ${r.lockRemoved}`);
    lines.push(`overall: ${r.ok ? "OK" : "FAIL"}`);
    return lines.join("\n");
  });
}

async function captureDiagnoseAll(dbPath: string, agentsRoot?: string): Promise<DiagnoseReport> {
  // Captura stdout do runDiagnose pra extrair report estruturado sem
  // duplicar lógica. format=json garante JSON parseável.
  const orig = process.stdout.write.bind(process.stdout);
  let captured = "";
  process.stdout.write = ((c: unknown): boolean => {
    captured += String(c);
    return true;
  }) as typeof process.stdout.write;
  try {
    await runDiagnose({
      dbPath,
      format: "json",
      subject: "all",
      ...(agentsRoot !== undefined ? { agentsRoot } : {}),
    });
  } finally {
    process.stdout.write = orig;
  }
  return JSON.parse(captured) as DiagnoseReport;
}

async function runSystemctl(args: ReadonlyArray<string>): Promise<SystemdResult> {
  const proc = Bun.spawn(["systemctl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const tail = (stderr || stdout).trim();
    return tail.length > 0 ? { ok: false, detail: tail } : { ok: false };
  }
  return { ok: true };
}
