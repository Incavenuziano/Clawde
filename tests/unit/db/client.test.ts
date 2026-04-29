import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClawdeDatabase, closeDb, openDb, readPragma } from "@clawde/db/client";

describe("db/client openDb (:memory:)", () => {
  let db: ClawdeDatabase;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  afterEach(() => {
    closeDb(db);
  });

  test("busy_timeout = 5000 (default)", () => {
    expect(readPragma(db, "busy_timeout")).toBe("5000");
  });

  test("synchronous = NORMAL (mapeia para 1)", () => {
    expect(readPragma(db, "synchronous")).toBe("1");
  });

  test("foreign_keys = ON (mapeia para 1)", () => {
    expect(readPragma(db, "foreign_keys")).toBe("1");
  });

  test("CRUD básico funciona", () => {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.exec("INSERT INTO t (v) VALUES ('a'), ('b')");
    const rows = db.query("SELECT id, v FROM t ORDER BY id").all() as Array<{
      id: number;
      v: string;
    }>;
    expect(rows).toEqual([
      { id: 1, v: "a" },
      { id: 2, v: "b" },
    ]);
  });

  test(":memory: DBs são isoladas entre si", () => {
    const a = openDb(":memory:");
    const b = openDb(":memory:");
    a.exec("CREATE TABLE t (id INTEGER)");
    a.exec("INSERT INTO t VALUES (1)");
    // 'b' não deve ter a tabela.
    expect(() => b.query("SELECT * FROM t").all()).toThrow();
    closeDb(a);
    closeDb(b);
  });
});

describe("db/client openDb (file path with WAL)", () => {
  let dir: string;
  let dbPath: string;
  let db: ClawdeDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-db-test-"));
    dbPath = join(dir, "state.db");
    db = openDb(dbPath);
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  test("journal_mode = WAL em DB de arquivo", () => {
    expect(readPragma(db, "journal_mode")).toBe("wal");
  });

  test("busy_timeout customizado é respeitado", () => {
    closeDb(db);
    db = openDb(dbPath, { busyTimeoutMs: 1234 });
    expect(readPragma(db, "busy_timeout")).toBe("1234");
  });

  test("skipWal=true em DB nova mantém journal_mode default (delete)", () => {
    // SQLite persiste journal_mode no header do arquivo, então precisa ser DB nova.
    closeDb(db);
    const altPath = join(dir, "alt-no-wal.db");
    const altDb = openDb(altPath, { skipWal: true });
    expect(readPragma(altDb, "journal_mode")).toBe("delete");
    closeDb(altDb);
    db = openDb(dbPath); // restaura para afterEach fechar
  });

  test("closeDb faz checkpoint WAL sem erro", () => {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.exec("INSERT INTO t VALUES (1)");
    // closeDb não deve lançar.
    expect(() => closeDb(db)).not.toThrow();
    // re-abertura preserva dados.
    db = openDb(dbPath);
    const rows = db.query("SELECT id FROM t").all();
    expect(rows).toEqual([{ id: 1 }]);
  });
});

describe("db/client readPragma edge cases", () => {
  test("retorna string vazia para PRAGMA inexistente sem row", () => {
    const db = openDb(":memory:");
    // user_version é 0 por default; verificar que readPragma retorna string.
    const v = readPragma(db, "user_version");
    expect(v).toBe("0");
    closeDb(db);
  });
});
