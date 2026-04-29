/**
 * `clawde dashboard` — info sobre o Datasette dashboard.
 *
 * Não inicia o servidor (isso é responsabilidade do systemd unit ou do
 * usuário). Apenas:
 *   - mostra URL canônica
 *   - reporta se Datasette está rodando (probe HTTP /-/ )
 *   - lista canned queries disponíveis (lidas do metadata.yaml localizado
 *     via --metadata flag ou path default)
 *
 * Sem dependência de Python: só usa fetch e file read.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface DashboardCmdOptions {
  readonly format: OutputFormat;
  readonly url: string;
  readonly metadataPath?: string;
  readonly probeTimeoutMs?: number;
}

interface DashboardReport {
  readonly url: string;
  readonly reachable: boolean;
  readonly version?: string;
  readonly metadataPath: string | null;
  readonly metadataExists: boolean;
  readonly cannedQueries: ReadonlyArray<string>;
  readonly hint?: string;
}

/**
 * Extração lightweight de query names de YAML — não parseamos YAML completo,
 * só varremos as keys imediatas dentro do bloco `queries:`.
 *
 * Suficiente porque metadata.yaml tem formato controlado (gerado por nós).
 * Se virar config arbitrário, troca por dep yaml real.
 */
export function extractQueryNames(yaml: string): ReadonlyArray<string> {
  const lines = yaml.split("\n");
  const names: string[] = [];
  let queriesIndent = -1;
  let queryNameIndent = -1;

  for (const line of lines) {
    if (line.trim().length === 0 || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;

    if (queriesIndent < 0) {
      if (/^\s*queries:\s*$/.test(line)) queriesIndent = indent;
      continue;
    }

    if (indent <= queriesIndent) {
      // Saímos do bloco queries.
      queriesIndent = -1;
      queryNameIndent = -1;
      continue;
    }

    // Primeiro filho de queries: define o indent das query keys.
    if (queryNameIndent < 0) queryNameIndent = indent;

    // Só capta nomes no nível direto, ignora sub-keys (title/sql/description).
    if (indent !== queryNameIndent) continue;

    const stripped = line.replace(/#.*$/, "").trimEnd();
    const m = /^\s+([a-z][a-z0-9_]*)\s*:\s*$/.exec(stripped);
    if (m !== null && m[1] !== undefined) names.push(m[1]);
  }
  return names;
}

async function probe(url: string, timeoutMs: number): Promise<{ ok: boolean; version?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/-/versions.json`, { signal: ctrl.signal });
    if (!r.ok) return { ok: false };
    const body = (await r.json()) as { datasette?: { version?: string } };
    const out: { ok: boolean; version?: string } = { ok: true };
    const v = body.datasette?.version;
    if (typeof v === "string") out.version = v;
    return out;
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function runDashboard(options: DashboardCmdOptions): Promise<number> {
  const metadataPath =
    options.metadataPath ?? join(process.env.HOME ?? "", ".clawde/deploy/datasette/metadata.yaml");

  let cannedQueries: ReadonlyArray<string> = [];
  let metadataExists = false;
  if (existsSync(metadataPath)) {
    metadataExists = true;
    try {
      cannedQueries = extractQueryNames(readFileSync(metadataPath, "utf-8"));
    } catch (err) {
      emitErr(`warn: failed to read metadata: ${(err as Error).message}`);
    }
  }

  const { ok: reachable, version } = await probe(options.url, options.probeTimeoutMs ?? 1500);

  const report: DashboardReport = {
    url: options.url,
    reachable,
    ...(version !== undefined && { version }),
    metadataPath: metadataExists ? metadataPath : null,
    metadataExists,
    cannedQueries,
    ...(reachable
      ? {}
      : {
          hint: "datasette not reachable — start with: datasette serve ~/.clawde/state.db --immutable ~/.clawde/state.db --metadata <metadata.yaml> --host 127.0.0.1 --port 18791",
        }),
  };

  emit(options.format, report, (d) => {
    const r = d as DashboardReport;
    const lines = [`url:           ${r.url}`, `reachable:     ${r.reachable ? "YES" : "no"}`];
    if (r.version !== undefined) lines.push(`version:       datasette ${r.version}`);
    lines.push(`metadata:      ${r.metadataPath ?? "(not found)"}`);
    lines.push(`canned queries: ${r.cannedQueries.length}`);
    for (const q of r.cannedQueries) lines.push(`  - ${q}`);
    if (r.hint !== undefined) {
      lines.push("");
      lines.push(`hint: ${r.hint}`);
    }
    return lines.join("\n");
  });

  return reachable ? 0 : 1;
}
