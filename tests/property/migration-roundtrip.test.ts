/**
 * Property test: para toda migration N existente, up(N) → down(N) → up(N)
 * deve produzir schema idêntico ao primeiro up.
 *
 * Não usa fast-check ainda (sem dep adicional na Fase 1) — itera por todas as
 * migrations descobertas. Quando F1 ganhar fast-check (futura prop test), virá.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import {
  applyPending,
  defaultMigrationsDir,
  discoverMigrations,
  rollbackTo,
} from "@clawde/db/migrations";

interface SchemaSnapshot {
  readonly tables: ReadonlyArray<{ name: string; sql: string }>;
  readonly indices: ReadonlyArray<{ name: string; sql: string }>;
  readonly triggers: ReadonlyArray<{ name: string; sql: string }>;
}

function snapshot(db: ClawdeDatabase): SchemaSnapshot {
  // Captura schema canônico, ordenado por nome.
  const fetch = (kind: string) =>
    (
      db
        .query(
          `SELECT name, sql FROM sqlite_schema
           WHERE type=? AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all(kind) as Array<{ name: string; sql: string | null }>
    ).map((r) => ({ name: r.name, sql: r.sql ?? "" }));

  return {
    tables: fetch("table"),
    indices: fetch("index"),
    triggers: fetch("trigger"),
  };
}

describe("property: migration roundtrip up→down→up", () => {
  let dbDir: string;
  let db: ClawdeDatabase;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "clawde-roundtrip-"));
    db = openDb(join(dbDir, "state.db"));
  });
  afterEach(() => {
    closeDb(db);
    rmSync(dbDir, { recursive: true, force: true });
  });

  test("up → down → up produz schema idêntico (todas as migrations reais)", () => {
    const dir = defaultMigrationsDir();
    const all = discoverMigrations(dir);
    expect(all.length).toBeGreaterThan(0);

    // Apply N up.
    applyPending(db, dir);
    const after1 = snapshot(db);

    // Rollback até 0 (reverte tudo).
    rollbackTo(db, dir, 0);

    // Apply N up novamente.
    applyPending(db, dir);
    const after2 = snapshot(db);

    expect(after2).toEqual(after1);
  });

  test("apply 2x consecutivos é equivalente a apply 1x", () => {
    const dir = defaultMigrationsDir();
    applyPending(db, dir);
    const after1 = snapshot(db);
    applyPending(db, dir);
    const after2 = snapshot(db);
    expect(after2).toEqual(after1);
  });

  test("rollback total deixa só tabelas SQLite internas (e _migrations recriada)", () => {
    const dir = defaultMigrationsDir();
    applyPending(db, dir);
    rollbackTo(db, dir, 0);

    const tables = (
      db
        .query("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);

    // Apenas _migrations recriada por ensureMigrationsTable do rollback.
    expect(tables).toEqual(["_migrations"]);
  });
});
