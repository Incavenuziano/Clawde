/**
 * Helper de setup de DB para testes integration/unit dos repositórios.
 * Cria DB temporária + aplica migrations reais.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";

export interface TestDb {
  readonly db: ClawdeDatabase;
  readonly cleanup: () => void;
}

export function makeTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "clawde-repo-test-"));
  const db = openDb(join(dir, "state.db"));
  applyPending(db, defaultMigrationsDir());
  const cleanup = () => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  };
  return { db, cleanup };
}
