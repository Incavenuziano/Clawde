/**
 * T-012: Integration test — receiver bootstrap + health.
 *
 * Spawns dist/receiver-main.js with a temp DB, polls GET /health until
 * 200, verifies HealthOk schema, then kills the process.
 *
 * Requires: bun run build:receiver (or build) before running.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending } from "@clawde/db/migrations";

const DIST = new URL("../../dist/receiver-main.js", import.meta.url).pathname;
const MIGRATIONS_DIR = new URL("../../src/db/migrations/", import.meta.url).pathname;
const BUN_BIN = Bun.which("bun") ?? "bun";

describe("receiver bootstrap integration", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  test(
    "spawns, /health returns 200 with HealthOk schema",
    async () => {
      if (!existsSync(DIST)) return;

      const dir = mkdtempSync(join(tmpdir(), "clawde-recv-boot-"));
      const port = 28960;
      const configPath = join(dir, "clawde.toml");
      writeFileSync(
        configPath,
        `[clawde]\nhome = "${dir}"\nlog_level = "ERROR"\n\n[receiver]\nlisten_tcp = "127.0.0.1:${port}"\nlisten_unix = "${dir}/recv.sock"\n`,
      );

      // Pre-apply migrations so the bundle (which resolves dist/ as migrations dir) finds tables.
      const db = openDb(join(dir, "state.db"));
      applyPending(db, MIGRATIONS_DIR);
      closeDb(db);

      const proc = Bun.spawn([BUN_BIN, "run", DIST], {
        env: { ...process.env, CLAWDE_CONFIG: configPath },
        stdout: "ignore",
        stderr: "ignore",
      });

      cleanups.push(() => {
        try {
          proc.kill();
        } catch {}
        rmSync(dir, { recursive: true, force: true });
      });

      let response: Response | null = null;
      for (let i = 0; i < 30; i++) {
        await Bun.sleep(100);
        try {
          response = await fetch(`http://127.0.0.1:${port}/health`);
          if (response.status === 200) break;
        } catch {}
      }

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      const body = (await response?.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.db).toBe("ok");
      expect(typeof body.version).toBe("string");
    },
    { timeout: 10_000 },
  );
});
