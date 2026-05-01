/**
 * Migration runner. Aplica `*.up.sql` em ordem numérica, registra em `_migrations`,
 * suporta rollback via `*.down.sql`. Idempotente: rerun não reaplica.
 *
 * Convenção de nome: `NNN_<slug>.up.sql` e `NNN_<slug>.down.sql`, onde NNN é
 * inteiro 0-padded (3+ dígitos).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sendAlertBestEffort } from "@clawde/alerts";
import type { ClawdeDatabase } from "../client.ts";

export interface MigrationFile {
  readonly version: number;
  readonly slug: string;
  readonly upPath: string;
  readonly downPath: string;
}

export interface MigrationStatus {
  readonly current: number;
  readonly latest: number;
  readonly pending: ReadonlyArray<number>;
  readonly applied: ReadonlyArray<{ version: number; appliedAt: string }>;
}

const FILENAME_RE = /^(\d{3,})_([a-z0-9_-]+)\.(up|down)\.sql$/;

/**
 * Lê o diretório de migrations e retorna lista validada (up+down par a par).
 * Ordem por version asc.
 */
export function discoverMigrations(dir: string): ReadonlyArray<MigrationFile> {
  const files = readdirSync(dir);
  const byVersion = new Map<number, { slug: string; up?: string; down?: string }>();

  for (const filename of files) {
    const match = filename.match(FILENAME_RE);
    if (match === null) {
      continue;
    }
    const versionStr = match[1] ?? "0";
    const slug = match[2] ?? "";
    const direction = match[3] ?? "";
    const version = Number.parseInt(versionStr, 10);
    if (!Number.isFinite(version)) {
      continue;
    }

    let entry = byVersion.get(version);
    if (entry === undefined) {
      entry = { slug };
      byVersion.set(version, entry);
    } else if (entry.slug !== slug) {
      throw new Error(
        `migration ${version}: slug mismatch ('${entry.slug}' vs '${slug}') in ${filename}`,
      );
    }

    const fullPath = join(dir, filename);
    if (direction === "up") {
      entry.up = fullPath;
    } else {
      entry.down = fullPath;
    }
  }

  const result: MigrationFile[] = [];
  for (const [version, entry] of [...byVersion.entries()].sort((a, b) => a[0] - b[0])) {
    if (entry.up === undefined || entry.down === undefined) {
      throw new Error(
        `migration ${version} (${entry.slug}): missing ${
          entry.up === undefined ? ".up.sql" : ".down.sql"
        }`,
      );
    }
    result.push({
      version,
      slug: entry.slug,
      upPath: entry.up,
      downPath: entry.down,
    });
  }
  return result;
}

/**
 * Garante que `_migrations` existe. Idempotente.
 * Necessário antes de qualquer apply quando DB ainda não foi inicializada.
 */
export function ensureMigrationsTable(db: ClawdeDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

/**
 * Retorna versão atual aplicada (MAX(version)). 0 se DB virgem.
 */
export function currentVersion(db: ClawdeDatabase): number {
  ensureMigrationsTable(db);
  const row = db.query("SELECT COALESCE(MAX(version), 0) AS v FROM _migrations").get() as {
    v: number;
  };
  return row.v;
}

/**
 * Status comparando DB vs filesystem.
 */
export function status(db: ClawdeDatabase, dir: string): MigrationStatus {
  ensureMigrationsTable(db);
  const all = discoverMigrations(dir);
  const applied = db
    .query("SELECT version, applied_at FROM _migrations ORDER BY version")
    .all() as Array<{ version: number; applied_at: string }>;
  const appliedSet = new Set(applied.map((r) => r.version));
  const current = applied.length === 0 ? 0 : (applied.at(-1)?.version ?? 0);
  const latest = all.length === 0 ? 0 : (all.at(-1)?.version ?? 0);
  const pending = all.filter((m) => !appliedSet.has(m.version)).map((m) => m.version);
  return {
    current,
    latest,
    pending,
    applied: applied.map((r) => ({ version: r.version, appliedAt: r.applied_at })),
  };
}

/**
 * Aplica migrations pendentes em ordem, dentro de transação por arquivo.
 * Rerun é idempotente (skip versões já aplicadas).
 */
export function applyPending(db: ClawdeDatabase, dir: string): ReadonlyArray<number> {
  ensureMigrationsTable(db);
  const all = discoverMigrations(dir);
  const applied = new Set(
    (db.query("SELECT version FROM _migrations").all() as Array<{ version: number }>).map(
      (r) => r.version,
    ),
  );

  const newlyApplied: number[] = [];
  for (const m of all) {
    if (applied.has(m.version)) {
      continue;
    }
    const sql = readFileSync(m.upPath, "utf-8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.run("INSERT OR IGNORE INTO _migrations (version) VALUES (?)", [m.version]);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      void sendAlertBestEffort({
        severity: "critical",
        trigger: "migration_fail",
        cooldownKey: `migration_fail_${m.version}`,
        payload: {
          version: m.version,
          slug: m.slug,
          error: (err as Error).message,
        },
      });
      throw new Error(`migration ${m.version} (${m.slug}) failed: ${(err as Error).message}`);
    }
    newlyApplied.push(m.version);
  }
  return newlyApplied;
}

/**
 * Rollback até `targetVersion` (inclusive — versões > target são revertidas).
 * Para reverter tudo, passe targetVersion = 0.
 */
export function rollbackTo(
  db: ClawdeDatabase,
  dir: string,
  targetVersion: number,
): ReadonlyArray<number> {
  ensureMigrationsTable(db);
  const all = discoverMigrations(dir);
  const applied = (
    db.query("SELECT version FROM _migrations ORDER BY version DESC").all() as Array<{
      version: number;
    }>
  ).map((r) => r.version);

  const reverted: number[] = [];
  for (const v of applied) {
    if (v <= targetVersion) {
      break;
    }
    const m = all.find((x) => x.version === v);
    if (m === undefined) {
      throw new Error(`cannot rollback version ${v}: down.sql not found in ${dir}`);
    }
    const sql = readFileSync(m.downPath, "utf-8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      // _migrations pode ter sido dropada pelo down; recria antes do DELETE.
      ensureMigrationsTable(db);
      db.run("DELETE FROM _migrations WHERE version = ?", [v]);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      void sendAlertBestEffort({
        severity: "critical",
        trigger: "migration_fail",
        cooldownKey: `migration_rollback_fail_${v}`,
        payload: {
          version: v,
          slug: m.slug,
          error: (err as Error).message,
        },
      });
      throw new Error(`rollback ${v} (${m.slug}) failed: ${(err as Error).message}`);
    }
    reverted.push(v);
  }
  return reverted;
}

/**
 * Path absoluto do diretório de migrations no projeto.
 * Resolvido relativo a este arquivo: `src/db/migrations/`.
 */
export function defaultMigrationsDir(): string {
  return new URL(".", import.meta.url).pathname;
}
