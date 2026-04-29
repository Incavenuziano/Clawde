/**
 * SQLite client wrapper. Configura WAL + busy_timeout + foreign_keys + synchronous=NORMAL
 * conforme ARCHITECTURE §11.2.
 *
 * Uso:
 *   const db = openDb("/path/to/state.db");
 *   ... queries ...
 *   closeDb(db);
 *
 * `:memory:` é suportado e cada call cria DB isolada (ideal para testes unitários).
 */

import { Database } from "bun:sqlite";

export interface OpenDbOptions {
  /**
   * Apenas para testes: pula PRAGMA WAL (não suportado em :memory:).
   * Default: false. Em prod sempre WAL.
   */
  readonly skipWal?: boolean;
  /**
   * Override do busy_timeout em ms. Default: 5000.
   */
  readonly busyTimeoutMs?: number;
}

export type ClawdeDatabase = Database;

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * Abre conexão SQLite com PRAGMAs canônicos do Clawde.
 *
 * Em DBs `:memory:`, journal_mode=WAL retorna "memory" (não "wal") porque
 * SQLite ignora WAL pra in-memory. Não é erro — comportamento documentado.
 */
export function openDb(path: string, options: OpenDbOptions = {}): ClawdeDatabase {
  const db = new Database(path, { create: true });
  const isMemory = path === ":memory:";
  const skipWal = options.skipWal ?? false;
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;

  if (!isMemory && !skipWal) {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/**
 * Fecha conexão. Em modo WAL, executa checkpoint TRUNCATE pra consolidar
 * o WAL no arquivo principal antes de fechar (boa prática em prod).
 *
 * Em :memory: ou DBs sem WAL, apenas fecha — checkpoint vira no-op.
 */
export function closeDb(db: ClawdeDatabase): void {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // PRAGMA falha se WAL não está ativo (ex: :memory:). Aceitável.
  }
  db.close();
}

/**
 * Lê o valor de um PRAGMA como string. Útil em testes/diagnose.
 */
export function readPragma(db: ClawdeDatabase, name: string): string {
  const row = db.query(`PRAGMA ${name}`).get() as Record<string, unknown> | null;
  if (row === null) {
    return "";
  }
  // PRAGMA queries retornam objeto { <pragma_name>: value }; primeira coluna é o valor.
  const firstKey = Object.keys(row)[0];
  if (firstKey === undefined) {
    return "";
  }
  return String(row[firstKey]);
}
