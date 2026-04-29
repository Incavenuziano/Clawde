/**
 * F8 — Litestream wrapper (ADR 0010 — multi-host backup).
 *
 * Litestream é um binário Go separado que replica WAL de SQLite pra B2/S3
 * em background. Aqui temos:
 *   - parser de output `litestream snapshots <db>` (texto tabular)
 *   - runner que invoca o binário (com mock injetável pra teste)
 *
 * NÃO tentamos parsing de YAML do litestream.yml — ele é gerenciado fora
 * (template em deploy/litestream/). Apenas observamos o estado dos
 * snapshots remotos.
 */

import { spawn } from "node:child_process";

export interface LitestreamSnapshot {
  /** Replica name conforme litestream.yml. */
  readonly replica: string;
  /** Generation ID (hex). */
  readonly generation: string;
  /** Index dentro da generation. */
  readonly index: number;
  /** Tamanho em bytes. */
  readonly size: number;
  /** Timestamp ISO-ish (litestream usa RFC3339). */
  readonly createdAt: string;
}

export class LitestreamError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "LitestreamError";
  }
}

export type LitestreamRunner = (
  args: ReadonlyArray<string>,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Runner default: spawn `litestream` no PATH. Substituível em testes.
 */
export const defaultLitestreamRunner: LitestreamRunner = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn("litestream", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
  });

/**
 * Parse output de `litestream snapshots <db>`.
 *
 * Formato observado (litestream 0.3.x):
 *
 *   replica  generation        index  size       created
 *   b2       fa7d2c19a8e...    42     12345678   2026-04-29T10:15:32Z
 *   ...
 *
 * Headers podem variar entre versões; usamos a primeira linha pra mapear
 * colunas por nome.
 */
export function parseSnapshots(output: string): ReadonlyArray<LitestreamSnapshot> {
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return []; // só header ou vazio

  const header = lines[0];
  if (header === undefined) return [];
  const headerCols = header
    .toLowerCase()
    .split(/\s+/)
    .filter((s) => s.length > 0);

  const idx = (name: string): number => headerCols.indexOf(name);
  const replicaIdx = idx("replica");
  const generationIdx = idx("generation");
  const indexIdx = idx("index");
  const sizeIdx = idx("size");
  const createdIdx = idx("created");

  if (replicaIdx < 0 || generationIdx < 0 || indexIdx < 0 || sizeIdx < 0 || createdIdx < 0) {
    return [];
  }

  const out: LitestreamSnapshot[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/);
    const replica = cols[replicaIdx];
    const generation = cols[generationIdx];
    const indexStr = cols[indexIdx];
    const sizeStr = cols[sizeIdx];
    const createdAt = cols[createdIdx];
    if (
      replica === undefined ||
      generation === undefined ||
      indexStr === undefined ||
      sizeStr === undefined ||
      createdAt === undefined
    ) {
      continue;
    }
    const index = Number.parseInt(indexStr, 10);
    const size = Number.parseInt(sizeStr, 10);
    if (!Number.isFinite(index) || !Number.isFinite(size)) continue;
    out.push({ replica, generation, index, size, createdAt });
  }
  return out;
}

/**
 * Lista snapshots remotos pra um db. Lança LitestreamError em exit != 0.
 */
export async function listSnapshots(
  dbPath: string,
  runner: LitestreamRunner = defaultLitestreamRunner,
): Promise<ReadonlyArray<LitestreamSnapshot>> {
  let result: Awaited<ReturnType<LitestreamRunner>>;
  try {
    result = await runner(["snapshots", dbPath]);
  } catch (err) {
    throw new LitestreamError(`failed to spawn litestream: ${(err as Error).message}`);
  }
  if (result.exitCode !== 0) {
    throw new LitestreamError(`litestream snapshots exit ${result.exitCode}`, result.stderr.trim());
  }
  return parseSnapshots(result.stdout);
}
