/**
 * F5.T47 — JSONL batch indexer.
 *
 * Lê arquivos `~/.claude/projects/<hash>/*.jsonl` (append-only nativo do
 * Claude Code), parseia line-by-line, popula memory_observations.
 *
 * Idempotente: dedup via composite key (sourceJsonl + lineOffset) — se mesmo
 * arquivo for re-processado, linhas já indexadas são puladas.
 *
 * Tolera arquivo truncado (último append em curso) — pula linha sem JSON
 * válido sem propagar erro.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MemoryRepo } from "@clawde/db/repositories/memory";
import type { ObservationKind } from "@clawde/domain/memory";
import type { Logger } from "@clawde/log";

export interface IndexerOptions {
  /** ~/.claude/projects (usuário) ou path custom em testes. */
  readonly jsonlRoot: string;
  /** Limite de bytes por arquivo pra evitar OOM em arquivos gigantes. */
  readonly maxFileBytes?: number;
  /** Limit de observations por arquivo (-1 = sem limite). */
  readonly maxPerFile?: number;
  readonly logger?: Logger;
}

export interface IndexResult {
  readonly filesScanned: number;
  readonly linesParsed: number;
  readonly observationsInserted: number;
  readonly errors: ReadonlyArray<{ file: string; line: number; reason: string }>;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50MB

interface ParsedLine {
  readonly sessionId: string | null;
  readonly content: string;
  readonly kind: ObservationKind;
}

/**
 * Parser tolerante a JSONL do Claude Code. Esquema varia por versão; aqui pega
 * apenas o que é universalmente útil:
 *   - {role, content} → text concatenado
 *   - {sessionId} ou {session_id} → vincula à sessão
 */
function parseJsonlLine(line: string): ParsedLine | null {
  if (line.length === 0) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sessionId =
    (typeof parsed.sessionId === "string" ? parsed.sessionId : null) ??
    (typeof parsed.session_id === "string" ? parsed.session_id : null);

  // Tenta extrair conteúdo textual.
  const content = extractContent(parsed);
  if (content === null || content.length === 0) return null;

  // Heurística de kind: assistant + texto longo → summary; senão observation.
  const role = parsed.role ?? parsed.message_role;
  const kind: ObservationKind =
    role === "assistant" && content.length > 200 ? "summary" : "observation";

  return { sessionId, content, kind };
}

function extractContent(obj: Record<string, unknown>): string | null {
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.text === "string") return obj.text;
  if (Array.isArray(obj.content)) {
    const parts: string[] = [];
    for (const item of obj.content) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (item !== null && typeof item === "object") {
        const block = item as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        }
      }
    }
    return parts.length > 0 ? parts.join("\n") : null;
  }
  // Fallback: serializa o objeto como hint de que existe algum conteúdo.
  if (typeof obj.message === "string") return obj.message;
  return null;
}

/**
 * Coleta arquivos .jsonl recursivamente em jsonlRoot.
 */
function collectJsonlFiles(root: string): ReadonlyArray<string> {
  const out: string[] = [];
  let entries: ReadonlyArray<string>;
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(root, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...collectJsonlFiles(full));
    } else if (stat.isFile() && entry.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Indexa todos os JSONL em jsonlRoot, populando memory_observations.
 * Idempotência via dedup_key custom em source_jsonl (path + offset).
 */
export function runIndexer(repo: MemoryRepo, options: IndexerOptions): IndexResult {
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const errors: Array<{ file: string; line: number; reason: string }> = [];
  const files = collectJsonlFiles(options.jsonlRoot);

  let totalLines = 0;
  let totalInserted = 0;

  for (const file of files) {
    let content: string;
    try {
      const stat = statSync(file);
      if (stat.size > maxBytes) {
        errors.push({
          file,
          line: 0,
          reason: `file too large (${stat.size} > ${maxBytes})`,
        });
        continue;
      }
      content = readFileSync(file, "utf-8");
    } catch (err) {
      errors.push({ file, line: 0, reason: (err as Error).message });
      continue;
    }

    const lines = content.split("\n");
    let perFileInserted = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === undefined || raw.length === 0) continue;
      totalLines += 1;

      const parsed = parseJsonlLine(raw);
      if (parsed === null) continue;

      // Dedup via source_jsonl = "<file>:<lineNum>" — repo bate por composite key.
      const sourceJsonl = `${file}:${i}`;

      // Se já indexado, skip — checamos via raw query.
      const existing = repo.findBySourceJsonl(sourceJsonl);
      if (existing !== null) continue;

      try {
        // FK: session_id só é válido se row existir em sessions; se não, set null.
        const sessionFkOk = parsed.sessionId !== null && repo.sessionExists(parsed.sessionId);
        repo.insertObservation({
          sessionId: sessionFkOk ? parsed.sessionId : null,
          sourceJsonl,
          kind: parsed.kind,
          content: parsed.content,
          importance: 0.5,
          consolidatedInto: null,
        });
        perFileInserted += 1;
        totalInserted += 1;
        if (
          options.maxPerFile !== undefined &&
          options.maxPerFile > 0 &&
          perFileInserted >= options.maxPerFile
        ) {
          break;
        }
      } catch (err) {
        errors.push({ file, line: i, reason: (err as Error).message });
      }
    }
  }

  options.logger?.info("jsonl indexer run", {
    files_scanned: files.length,
    lines_parsed: totalLines,
    observations_inserted: totalInserted,
    errors: errors.length,
  });

  return {
    filesScanned: files.length,
    linesParsed: totalLines,
    observationsInserted: totalInserted,
    errors,
  };
}
