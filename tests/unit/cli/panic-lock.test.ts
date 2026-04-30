import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPanicLock,
  panicLockExists,
  readPanicLock,
  removePanicLock,
} from "@clawde/cli/commands/panic";

describe("cli/commands/panic lock helpers", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-panic-lock-"));
    lockPath = join(dir, "subdir", "panic.lock");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("createPanicLock cria diretório pai e arquivo com info", () => {
    const info = createPanicLock(lockPath, "manual operator");
    expect(existsSync(lockPath)).toBe(true);
    expect(info.reason).toBe("manual operator");
    expect(info.pid).toBe(process.pid);
    expect(info.hostname.length).toBeGreaterThan(0);
    expect(info.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const persisted = JSON.parse(readFileSync(lockPath, "utf-8")) as {
      reason: string;
      pid: number;
    };
    expect(persisted.reason).toBe("manual operator");
    expect(persisted.pid).toBe(process.pid);
  });

  test("createPanicLock é idempotente — segunda chamada preserva info original", () => {
    const first = createPanicLock(lockPath, "first");
    const second = createPanicLock(lockPath, "second");
    expect(second.reason).toBe("first");
    expect(second.ts).toBe(first.ts);
    expect(second.pid).toBe(first.pid);
  });

  test("createPanicLock sem reason omite o campo", () => {
    const info = createPanicLock(lockPath);
    expect(info.reason).toBeUndefined();
    const persisted = JSON.parse(readFileSync(lockPath, "utf-8")) as Record<string, unknown>;
    expect(persisted.reason).toBeUndefined();
  });

  test("panicLockExists reflete estado do filesystem", () => {
    expect(panicLockExists(lockPath)).toBe(false);
    createPanicLock(lockPath);
    expect(panicLockExists(lockPath)).toBe(true);
  });

  test("readPanicLock retorna info gravada", () => {
    createPanicLock(lockPath, "halt for incident");
    const info = readPanicLock(lockPath);
    expect(info.reason).toBe("halt for incident");
    expect(info.pid).toBe(process.pid);
  });

  test("removePanicLock é idempotente — no-op se ausente", () => {
    expect(() => removePanicLock(lockPath)).not.toThrow();
    createPanicLock(lockPath);
    removePanicLock(lockPath);
    expect(panicLockExists(lockPath)).toBe(false);
    expect(() => removePanicLock(lockPath)).not.toThrow();
  });
});
