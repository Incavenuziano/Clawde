/**
 * `clawde reflect [--since 24h]` — P3.4 (T-112 + T-113).
 *
 * Coleta janela operacional recente (events + memory_observations), monta
 * prompt estruturado conforme contrato do `.claude/agents/reflector/AGENT.md`
 * e enfileira via POST /enqueue. Worker oneshot processa em prioridade LOW.
 *
 * `dedupKey` horário evita duplicatas se o cron disparar mais de uma vez
 * dentro da mesma hora (mesma janela = mesma reflexão).
 */

import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { EventsRepo } from "@clawde/db/repositories/events";
import { MemoryRepo } from "@clawde/db/repositories/memory";
import type { Event } from "@clawde/domain/event";
import type { MemoryObservation } from "@clawde/domain/memory";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface ReflectOptions {
  readonly since: string;
  readonly receiverUrl: string;
  readonly dbPath: string;
  readonly format: OutputFormat;
  /** Limite de events buscados na janela (default 500). */
  readonly maxEvents?: number;
  /** Limite de observations buscadas na janela (default 200). */
  readonly maxObservations?: number;
  /** Override de fetch para testes. */
  readonly fetchFn?: typeof fetch;
  /** Override de "agora" para testes (ms epoch). */
  readonly nowMs?: number;
}

interface EnqueueResponse {
  readonly taskId: number;
  readonly traceId: string;
  readonly deduped: boolean;
}

/**
 * Parseia `--since` no formato `<N><unit>` onde unit ∈ {h, d, m, w}.
 * Retorna milissegundos. Throw em entrada inválida.
 */
export function parseSinceToMs(spec: string): number {
  const match = /^(\d+)\s*([hdmw])$/.exec(spec.trim());
  if (match === null) {
    throw new Error(`invalid --since '${spec}' (expected <N>{h|d|m|w})`);
  }
  const n = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2];
  switch (unit) {
    case "m":
      return n * 60_000;
    case "h":
      return n * 60 * 60_000;
    case "d":
      return n * 24 * 60 * 60_000;
    case "w":
      return n * 7 * 24 * 60 * 60_000;
    default:
      throw new Error(`invalid unit '${unit ?? ""}' in --since`);
  }
}

/**
 * Renderiza prompt estruturado consumido pelo agente `reflector` (AGENT.md).
 * Seções: meta da janela, events, observations. Markdown leve pra fácil parse
 * pelo modelo. T-113.
 */
export function renderReflectorPrompt(input: {
  readonly sinceIso: string;
  readonly nowIso: string;
  readonly events: ReadonlyArray<Event>;
  readonly observations: ReadonlyArray<MemoryObservation>;
}): string {
  const lines: string[] = [];
  lines.push("# Reflection window");
  lines.push("");
  lines.push(`- since: ${input.sinceIso}`);
  lines.push(`- until: ${input.nowIso}`);
  lines.push(`- events_count: ${input.events.length}`);
  lines.push(`- observations_count: ${input.observations.length}`);
  lines.push("");
  lines.push("## events_window");
  lines.push("");
  if (input.events.length === 0) {
    lines.push("(no events in window)");
  } else {
    for (const e of input.events) {
      const trace = e.traceId !== null ? ` trace=${e.traceId}` : "";
      const taskRun = e.taskRunId !== null ? ` task_run=${e.taskRunId}` : "";
      const payload = JSON.stringify(e.payload);
      lines.push(`- [${e.ts}] ${e.kind}${taskRun}${trace} payload=${payload}`);
    }
  }
  lines.push("");
  lines.push("## observations_window");
  lines.push("");
  if (input.observations.length === 0) {
    lines.push("(no observations in window)");
  } else {
    for (const o of input.observations) {
      const session = o.sessionId !== null ? ` session=${o.sessionId}` : "";
      lines.push(
        `- [${o.createdAt}] kind=${o.kind} importance=${o.importance.toFixed(2)} id=${o.id}${session}`,
      );
      lines.push(`  ${o.content.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  }
  lines.push("");
  lines.push("## task");
  lines.push("");
  lines.push(
    "Aplique as heurísticas do AGENT.md (3+ ocorrências = candidato a lesson; 1 falha catastrófica = importance alta) e retorne JSON `{lessons: [...]}` per contrato.",
  );
  return lines.join("\n");
}

/**
 * Constrói dedupKey horário pra que o cron não enfileire 2 reflections por
 * janela (mesma hora UTC = mesma reflection conceitual).
 */
function buildDedupKey(nowIso: string): string {
  // YYYY-MM-DDTHH (até hora) — ISO truncado.
  return `reflect:${nowIso.slice(0, 13)}`;
}

export async function runReflect(options: ReflectOptions): Promise<number> {
  let sinceMs: number;
  try {
    sinceMs = parseSinceToMs(options.since);
  } catch (err) {
    emitErr(`error: ${(err as Error).message}`);
    return 1;
  }

  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const sinceIso = new Date(nowMs - sinceMs).toISOString();
  // SQLite armazena `datetime('now')` como `YYYY-MM-DD HH:MM:SS`. Convertemos
  // ISO 8601 (com 'T' e 'Z') pro formato comparável por string.
  const cutoffSqlite = sinceIso.replace("T", " ").replace(/\..+$/, "");

  let db: ClawdeDatabase | null = null;
  try {
    db = openDb(options.dbPath);
    const eventsRepo = new EventsRepo(db);
    const memoryRepo = new MemoryRepo(db);

    const events = eventsRepo.querySince(cutoffSqlite, options.maxEvents ?? 500);
    const observations = memoryRepo.findRecent(cutoffSqlite, options.maxObservations ?? 200);

    const prompt = renderReflectorPrompt({
      sinceIso,
      nowIso,
      events,
      observations,
    });

    const dedupKey = buildDedupKey(nowIso);
    const fetchImpl = options.fetchFn ?? fetch;
    const response = await fetchImpl(`${options.receiverUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        priority: "LOW",
        agent: "reflector",
        dedupKey,
        sourceMetadata: {
          since_iso: sinceIso,
          events_count: events.length,
          observations_count: observations.length,
        },
      }),
    });

    if (!response.ok && response.status !== 409) {
      emitErr(`error: receiver returned ${response.status}: ${await response.text()}`);
      return 2;
    }

    const body = (await response.json()) as EnqueueResponse;
    emit(options.format, body, (d) => {
      const r = d as EnqueueResponse;
      const dedupSuffix = r.deduped ? " (deduped — already enqueued in this hour)" : "";
      return `reflect: enqueued task ${r.taskId} (trace ${r.traceId})${dedupSuffix}`;
    });
    return 0;
  } catch (err) {
    emitErr(`error: ${(err as Error).message}`);
    return 1;
  } finally {
    if (db !== null) closeDb(db);
  }
}
