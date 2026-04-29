/**
 * F5.T55 — `clawde memory` CLI commands.
 *
 * Subcomandos:
 *   memory search "<query>" --top-k N --kind observation|lesson|all
 *   memory show <id>
 *   memory stats          # counts por kind + distribuição importance
 *   memory prune --dry-run
 *   memory reindex        # roda jsonl-indexer
 *   memory recalc         # roda recalcImportance
 *   memory inject "<query>"  # debug: mostra snippet de prior_context
 */

import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { MemoryRepo } from "@clawde/db/repositories/memory";
import type { ObservationKind } from "@clawde/domain/memory";
import {
  DEFAULT_PRUNE_OPTIONS,
  buildMemoryContext,
  prune,
  recalcImportance,
  runIndexer,
  searchHybrid,
} from "@clawde/memory";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface MemoryCmdOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  readonly action: "search" | "show" | "stats" | "prune" | "reindex" | "recalc" | "inject";
  readonly query?: string;
  readonly id?: number;
  readonly topK?: number;
  readonly kind?: ObservationKind | "all";
  readonly dryRun?: boolean;
  readonly jsonlRoot?: string;
}

export async function runMemory(options: MemoryCmdOptions): Promise<number> {
  let db: ClawdeDatabase;
  try {
    db = openDb(options.dbPath);
  } catch (err) {
    emitErr(`error opening db: ${(err as Error).message}`);
    return 2;
  }

  const repo = new MemoryRepo(db);
  try {
    switch (options.action) {
      case "search":
        return await actionSearch(repo, options);
      case "show":
        return actionShow(repo, options);
      case "stats":
        return actionStats(repo, db, options.format);
      case "prune":
        return actionPrune(repo, options);
      case "reindex":
        return actionReindex(repo, options);
      case "recalc":
        return actionRecalc(repo, db, options.format);
      case "inject":
        return await actionInject(repo, options);
      default:
        emitErr(`unknown memory action: ${(options.action as string) ?? "<missing>"}`);
        return 1;
    }
  } finally {
    closeDb(db);
  }
}

async function actionSearch(repo: MemoryRepo, options: MemoryCmdOptions): Promise<number> {
  if (options.query === undefined || options.query.length === 0) {
    emitErr("error: query required (memory search <query>)");
    return 1;
  }
  const results = await searchHybrid(repo, {
    query: options.query,
    limit: options.topK ?? 5,
  });
  const filtered =
    options.kind !== undefined && options.kind !== "all"
      ? results.filter((r) => r.observation.kind === options.kind)
      : results;
  emit(options.format, filtered, (d) => {
    const list = d as typeof filtered;
    if (list.length === 0) return "(no matches)";
    return list
      .map(
        (r, i) =>
          `${i + 1}. [${r.observation.kind}|imp=${r.observation.importance.toFixed(2)}|${r.matchType}] ${r.observation.content.slice(0, 200)}`,
      )
      .join("\n");
  });
  return 0;
}

function actionShow(repo: MemoryRepo, options: MemoryCmdOptions): number {
  if (options.id === undefined) {
    emitErr("error: id required (memory show <id>)");
    return 1;
  }
  const obs = repo.findById(options.id);
  if (obs === null) {
    emitErr(`observation ${options.id} not found`);
    return 2;
  }
  emit(options.format, obs, (d) => {
    const o = d as typeof obs;
    return [
      `id:               ${o.id}`,
      `kind:             ${o.kind}`,
      `importance:       ${o.importance.toFixed(3)}`,
      `session_id:       ${o.sessionId ?? "(null)"}`,
      `source_jsonl:     ${o.sourceJsonl ?? "(null)"}`,
      `consolidated_into: ${o.consolidatedInto ?? "(null)"}`,
      `created_at:       ${o.createdAt}`,
      "",
      "content:",
      o.content,
    ].join("\n");
  });
  return 0;
}

function actionStats(
  repo: MemoryRepo,
  // biome-ignore lint/suspicious/noExplicitAny: db type stronger inferred
  db: any,
  format: OutputFormat,
): number {
  const byKind = db
    .query("SELECT kind, COUNT(*) AS n FROM memory_observations GROUP BY kind")
    .all() as Array<{ kind: string; n: number }>;
  const importance = db
    .query(
      `SELECT
         COUNT(*) AS total,
         AVG(importance) AS avg,
         MIN(importance) AS min,
         MAX(importance) AS max
       FROM memory_observations`,
    )
    .get() as { total: number; avg: number; min: number; max: number } | null;

  const stats = { byKind, importance };
  emit(format, stats, (d) => {
    const data = d as typeof stats;
    const lines: string[] = ["counts by kind:"];
    for (const k of data.byKind) {
      lines.push(`  ${k.kind.padEnd(15)}: ${k.n}`);
    }
    lines.push("");
    lines.push("importance distribution:");
    if (data.importance !== null) {
      lines.push(`  total:  ${data.importance.total}`);
      lines.push(`  avg:    ${(data.importance.avg ?? 0).toFixed(3)}`);
      lines.push(`  min:    ${(data.importance.min ?? 0).toFixed(3)}`);
      lines.push(`  max:    ${(data.importance.max ?? 0).toFixed(3)}`);
    }
    // Suppress unused-variable warning for `repo`.
    void repo;
    return lines.join("\n");
  });
  return 0;
}

function actionPrune(repo: MemoryRepo, options: MemoryCmdOptions): number {
  const result = prune(repo, {
    ...DEFAULT_PRUNE_OPTIONS,
    dryRun: options.dryRun === true,
  });
  emit(options.format, result, (d) => {
    const r = d as typeof result;
    return r.dryRun
      ? `dry-run: would delete ${r.deleted} observations (cutoff=${r.cutoffDate}, importance<${r.importanceCutoff})`
      : `deleted ${r.deleted} observations (cutoff=${r.cutoffDate})`;
  });
  return 0;
}

function actionReindex(repo: MemoryRepo, options: MemoryCmdOptions): number {
  const root = options.jsonlRoot ?? `${process.env.HOME ?? ""}/.claude/projects`;
  const result = runIndexer(repo, { jsonlRoot: root });
  emit(options.format, result, (d) => {
    const r = d as typeof result;
    return [
      `files scanned:       ${r.filesScanned}`,
      `lines parsed:        ${r.linesParsed}`,
      `observations added:  ${r.observationsInserted}`,
      `errors:              ${r.errors.length}`,
    ].join("\n");
  });
  return 0;
}

function actionRecalc(
  repo: MemoryRepo,
  // biome-ignore lint/suspicious/noExplicitAny: db type bridged
  db: any,
  format: OutputFormat,
): number {
  const result = recalcImportance(db, repo);
  emit(format, result, (d) => {
    const r = d as typeof result;
    return `recalc: updated=${r.updated} skipped=${r.skipped}`;
  });
  return 0;
}

async function actionInject(repo: MemoryRepo, options: MemoryCmdOptions): Promise<number> {
  if (options.query === undefined || options.query.length === 0) {
    emitErr("error: query required (memory inject <query>)");
    return 1;
  }
  const result = await buildMemoryContext(repo, options.query);
  emit(options.format, result, (d) => {
    const r = d as typeof result;
    if (!r.injected) return "(no context to inject)";
    return r.snippet;
  });
  return 0;
}
