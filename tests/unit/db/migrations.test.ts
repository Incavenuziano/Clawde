import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import {
  applyPending,
  currentVersion,
  defaultMigrationsDir,
  discoverMigrations,
  rollbackTo,
  status,
} from "@clawde/db/migrations";

describe("db/migrations discoverMigrations", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-mig-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("ordena por version ascendente", () => {
    writeFileSync(join(dir, "002_b.up.sql"), "");
    writeFileSync(join(dir, "002_b.down.sql"), "");
    writeFileSync(join(dir, "001_a.up.sql"), "");
    writeFileSync(join(dir, "001_a.down.sql"), "");
    const all = discoverMigrations(dir);
    expect(all.map((m) => m.version)).toEqual([1, 2]);
  });

  test("ignora arquivos não-migration", () => {
    writeFileSync(join(dir, "001_a.up.sql"), "");
    writeFileSync(join(dir, "001_a.down.sql"), "");
    writeFileSync(join(dir, "README.md"), "");
    const all = discoverMigrations(dir);
    expect(all).toHaveLength(1);
  });

  test("erro se up.sql faltar", () => {
    writeFileSync(join(dir, "001_a.down.sql"), "");
    expect(() => discoverMigrations(dir)).toThrow(/missing \.up\.sql/);
  });

  test("erro se down.sql faltar", () => {
    writeFileSync(join(dir, "001_a.up.sql"), "");
    expect(() => discoverMigrations(dir)).toThrow(/missing \.down\.sql/);
  });

  test("erro se slug divergir entre up/down", () => {
    writeFileSync(join(dir, "001_a.up.sql"), "");
    writeFileSync(join(dir, "001_b.down.sql"), "");
    expect(() => discoverMigrations(dir)).toThrow(/slug mismatch/);
  });
});

describe("db/migrations applyPending + idempotência", () => {
  let dbDir: string;
  let migDir: string;
  let db: ClawdeDatabase;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "clawde-db-test-"));
    migDir = mkdtempSync(join(tmpdir(), "clawde-mig-"));
    db = openDb(join(dbDir, "state.db"));
    // Migration mínima: cria tabela t1.
    writeFileSync(
      join(migDir, "001_init.up.sql"),
      "CREATE TABLE t1 (id INTEGER PRIMARY KEY, v TEXT);",
    );
    writeFileSync(join(migDir, "001_init.down.sql"), "DROP TABLE IF EXISTS t1;");
  });
  afterEach(() => {
    closeDb(db);
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(migDir, { recursive: true, force: true });
  });

  test("apply em DB virgem cria tabela e registra versão", () => {
    const applied = applyPending(db, migDir);
    expect(applied).toEqual([1]);
    expect(currentVersion(db)).toBe(1);

    db.exec("INSERT INTO t1 (v) VALUES ('hello')");
    const row = db.query("SELECT v FROM t1").get() as { v: string };
    expect(row.v).toBe("hello");
  });

  test("rerun é idempotente: 0 versões aplicadas na 2ª chamada", () => {
    applyPending(db, migDir);
    const second = applyPending(db, migDir);
    expect(second).toEqual([]);
    expect(currentVersion(db)).toBe(1);
  });

  test("status reporta pending e applied corretos", () => {
    writeFileSync(join(migDir, "002_more.up.sql"), "CREATE TABLE t2 (id INTEGER PRIMARY KEY);");
    writeFileSync(join(migDir, "002_more.down.sql"), "DROP TABLE IF EXISTS t2;");

    expect(status(db, migDir).pending).toEqual([1, 2]);

    applyPending(db, migDir);
    const s = status(db, migDir);
    expect(s.current).toBe(2);
    expect(s.latest).toBe(2);
    expect(s.pending).toEqual([]);
    expect(s.applied).toHaveLength(2);
  });

  test("falha de SQL faz ROLLBACK e mantém versão anterior", () => {
    applyPending(db, migDir); // aplica 001
    writeFileSync(join(migDir, "002_bad.up.sql"), "CREATE TABLE t2 (id); INVALID_SQL_HERE;");
    writeFileSync(join(migDir, "002_bad.down.sql"), "DROP TABLE IF EXISTS t2;");

    expect(() => applyPending(db, migDir)).toThrow(/migration 2.*failed/);
    // 002 não deve estar aplicada nem t2 deve existir.
    expect(currentVersion(db)).toBe(1);
    expect(() => db.query("SELECT * FROM t2").get()).toThrow();
  });
});

describe("db/migrations rollbackTo", () => {
  let dbDir: string;
  let migDir: string;
  let db: ClawdeDatabase;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "clawde-db-test-"));
    migDir = mkdtempSync(join(tmpdir(), "clawde-mig-"));
    db = openDb(join(dbDir, "state.db"));
    writeFileSync(join(migDir, "001_a.up.sql"), "CREATE TABLE t1 (id INTEGER PRIMARY KEY);");
    writeFileSync(join(migDir, "001_a.down.sql"), "DROP TABLE IF EXISTS t1;");
    writeFileSync(join(migDir, "002_b.up.sql"), "CREATE TABLE t2 (id INTEGER PRIMARY KEY);");
    writeFileSync(join(migDir, "002_b.down.sql"), "DROP TABLE IF EXISTS t2;");
  });
  afterEach(() => {
    closeDb(db);
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(migDir, { recursive: true, force: true });
  });

  test("rollback de 2 → 1 remove apenas última", () => {
    applyPending(db, migDir);
    expect(currentVersion(db)).toBe(2);

    const reverted = rollbackTo(db, migDir, 1);
    expect(reverted).toEqual([2]);
    expect(currentVersion(db)).toBe(1);

    // t1 ainda existe; t2 não.
    expect(() => db.query("SELECT * FROM t1").all()).not.toThrow();
    expect(() => db.query("SELECT * FROM t2").all()).toThrow();
  });

  test("rollback até 0 reverte tudo", () => {
    applyPending(db, migDir);
    rollbackTo(db, migDir, 0);
    expect(currentVersion(db)).toBe(0);
    expect(() => db.query("SELECT * FROM t1").all()).toThrow();
    expect(() => db.query("SELECT * FROM t2").all()).toThrow();
  });
});

describe("db/migrations real schema (defaultMigrationsDir)", () => {
  let dbDir: string;
  let db: ClawdeDatabase;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "clawde-real-mig-"));
    db = openDb(join(dbDir, "state.db"));
  });
  afterEach(() => {
    closeDb(db);
    rmSync(dbDir, { recursive: true, force: true });
  });

  test("aplica migration 001 real e PRAGMA integrity_check = ok", () => {
    const applied = applyPending(db, defaultMigrationsDir());
    expect(applied).toEqual([1]);
    const row = db.query("PRAGMA integrity_check").get() as { integrity_check: string };
    expect(row.integrity_check).toBe("ok");
  });

  test("schema 001 cria todas as tabelas esperadas", () => {
    applyPending(db, defaultMigrationsDir());
    // Filtra internas do SQLite + internas dos FTS5 (suffixes _config, _data,
    // _docsize, _idx). As virtual tables principais (messages_fts, memory_fts)
    // permanecem.
    const tables = (
      db
        .query(
          `SELECT name FROM sqlite_schema
           WHERE type='table'
             AND name NOT LIKE 'sqlite_%'
             AND name NOT LIKE '%_fts_config'
             AND name NOT LIKE '%_fts_data'
             AND name NOT LIKE '%_fts_docsize'
             AND name NOT LIKE '%_fts_idx'`,
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toContain("tasks");
    expect(tables).toContain("task_runs");
    expect(tables).toContain("sessions");
    expect(tables).toContain("messages");
    expect(tables).toContain("messages_fts");
    expect(tables).toContain("memory_observations");
    expect(tables).toContain("memory_fts");
    expect(tables).toContain("quota_ledger");
    expect(tables).toContain("events");
    expect(tables).toContain("_retention_grant");
    expect(tables).toContain("_migrations");
  });
});
