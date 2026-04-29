/**
 * T-013: Integration test — worker dry-run on empty queue.
 *
 * Spawns dist/worker-main.js with an empty DB, verifies it exits 0
 * in <5s, and that no task_start or lease_expired events were emitted.
 *
 * Requires: bun run build:worker (or build) before running.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";

const DIST = new URL("../../dist/worker-main.js", import.meta.url).pathname;
const MIGRATIONS_DIR = new URL("../../src/db/migrations/", import.meta.url).pathname;
const BUN_BIN = Bun.which("bun") ?? "bun";

describe("worker bootstrap integration", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  test(
    "exits 0 in <5s on empty queue; no task_start or lease_expired events",
    async () => {
      if (!existsSync(DIST)) {
        console.warn(`SKIP: ${DIST} not built — run bun run build:worker first`);
        return;
      }

      const dir = mkdtempSync(join(tmpdir(), "clawde-worker-boot-"));
      const dbPath = join(dir, "state.db");
      const configPath = join(dir, "clawde.toml");
      writeFileSync(configPath, `[clawde]\nhome = "${dir}"\nlog_level = "ERROR"\n`);

      // Pre-apply migrations so the bundle (which resolves dist/ as migrations dir) finds tables.
      const preDb = openDb(dbPath);
      applyPending(preDb, MIGRATIONS_DIR);
      closeDb(preDb);

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

      const exitCode = await Promise.race([
        proc.exited,
        Bun.sleep(5000).then(() => {
          proc.kill();
          return -1 as number;
        }),
      ]);

      expect(exitCode).toBe(0);

      const db = openDb(dbPath);
      const eventsRepo = new EventsRepo(db);
      const taskStartCount = eventsRepo.queryByKind("task_start").length;
      const leaseExpiredCount = eventsRepo.queryByKind("lease_expired").length;
      db.close();

      expect(taskStartCount).toBe(0);
      expect(leaseExpiredCount).toBe(0);
    },
    { timeout: 8_000 },
  );
});
