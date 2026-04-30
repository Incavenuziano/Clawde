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
