/**
 * `clawde panic-stop` / `panic-resume` — gate operacional pra travar/destravar
 * o daemon. Idempotente. Lock file persistente em `<clawde.home>/panic.lock`
 * sinaliza estado pro `panic-resume` e pra outros operadores.
 *
 * Sub-fase P3.2 (T-104, T-105). Spec em EXECUTION_BACKLOG.md §P3.2.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
      if (fail !== undefined) return { ok: false, ...(fail.detail !== undefined ? { detail: fail.detail } : {}) };
      active.set(unit, false);
      return { ok: true };
    },
    async start(unit) {
      calls.push({ op: "start", unit });
      const fail = fails.get(failKey("start", unit));
      if (fail !== undefined) return { ok: false, ...(fail.detail !== undefined ? { detail: fail.detail } : {}) };
      active.set(unit, true);
      return { ok: true };
    },
    async isActive(unit) {
      calls.push({ op: "isActive", unit });
      return active.get(unit) ?? false;
    },
  };
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
