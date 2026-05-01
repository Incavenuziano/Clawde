/**
 * `clawde config show|validate <path>` — visibility e validação da
 * configuração resolved. Sub-fase P3.2 (T-109, T-110).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ClawdeConfigSchema } from "@clawde/config";
import { ConfigError, loadConfig } from "@clawde/config";
import { parse as parseTOML } from "smol-toml";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface ConfigShowOptions {
  readonly format: OutputFormat;
  readonly path?: string;
}

export interface ConfigValidateOptions {
  readonly format: OutputFormat;
  readonly path: string;
}

export type ConfigOrigin = "default" | "toml" | "env";

export interface ConfigShowReport {
  readonly resolvedPath: string;
  readonly tomlExists: boolean;
  readonly envOverrides: ReadonlyArray<string>;
  /**
   * Origem por campo (path dotted → "default" | "toml" | "env").
   * Acceptance T-109: spec exige origem de cada campo, não apenas global.
   * Precedência mirror de loadConfig: env > toml > default.
   */
  readonly sources: Readonly<Record<string, ConfigOrigin>>;
  readonly config: unknown;
}

const ENV_KEYS = [
  "CLAWDE_CONFIG",
  "CLAWDE_LOG_LEVEL",
  "CLAWDE_HOME",
  "CLAWDE_CLI_PATH",
  "CLAWDE_QUOTA_PLAN",
] as const;

/**
 * Mapeia env var → caminho dotted no config schema. Mantém em sync com
 * ENV_OVERRIDES de src/config/load.ts.
 */
const ENV_PATH_MAP: Readonly<Record<string, string>> = {
  CLAWDE_LOG_LEVEL: "clawde.log_level",
  CLAWDE_HOME: "clawde.home",
  CLAWDE_CLI_PATH: "worker.cli_path",
  CLAWDE_QUOTA_PLAN: "quota.plan",
};

export function runConfigShow(options: ConfigShowOptions): number {
  try {
    const resolvedPath = resolveExplicitPath(options.path);
    const config = loadConfig(options.path !== undefined ? { path: options.path } : {});
    const envOverrides = ENV_KEYS.filter(
      (k) => process.env[k] !== undefined && process.env[k] !== "",
    );
    const tomlExists = existsSync(resolvedPath);
    const rawToml = tomlExists ? readTomlSafe(resolvedPath) : {};
    const sources = computeFieldSources(
      config as Record<string, unknown>,
      rawToml,
      process.env as Record<string, string | undefined>,
    );
    const report: ConfigShowReport = {
      resolvedPath,
      tomlExists,
      envOverrides,
      sources,
      config,
    };
    emit(options.format, report, (d) => {
      const r = d as ConfigShowReport;
      const lines: string[] = [
        `resolved path:  ${r.resolvedPath}${r.tomlExists ? "" : " (not found — using defaults)"}`,
        `env overrides:  ${r.envOverrides.length === 0 ? "(none)" : r.envOverrides.join(", ")}`,
        "",
        "field origins (env > toml > default):",
      ];
      const sortedKeys = Object.keys(r.sources).sort();
      for (const k of sortedKeys) {
        lines.push(`  ${k.padEnd(40)} ${r.sources[k]}`);
      }
      lines.push("", JSON.stringify(r.config, null, 2));
      return lines.join("\n");
    });
    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      emitErr(err.message);
      return 1;
    }
    emitErr(`error: ${(err as Error).message}`);
    return 2;
  }
}

export interface ConfigValidateReport {
  readonly path: string;
  readonly ok: boolean;
  readonly issues: ReadonlyArray<{ path: string; message: string }>;
}

export function runConfigValidate(options: ConfigValidateOptions): number {
  try {
    if (!existsSync(options.path)) {
      emitErr(`error: config file not found: ${options.path}`);
      return 1;
    }
    loadConfig({ path: options.path, env: {} });
    const report: ConfigValidateReport = { path: options.path, ok: true, issues: [] };
    emit(options.format, report, () => `[OK ] ${options.path} valid`);
    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      const report: ConfigValidateReport = {
        path: options.path,
        ok: false,
        issues: err.issues.length > 0 ? err.issues : [{ path: "<root>", message: err.message }],
      };
      emit(options.format, report, (d) => {
        const r = d as ConfigValidateReport;
        const lines = [`[FAIL] ${r.path}`];
        for (const iss of r.issues) {
          lines.push(`  ${iss.path || "<root>"}: ${iss.message}`);
        }
        return lines.join("\n");
      });
      return 1;
    }
    emitErr(`error: ${(err as Error).message}`);
    return 2;
  }
}

function resolveExplicitPath(override?: string): string {
  if (override !== undefined && override.length > 0) return override;
  if (process.env.CLAWDE_CONFIG !== undefined && process.env.CLAWDE_CONFIG.length > 0) {
    return process.env.CLAWDE_CONFIG;
  }
  return join(homedir(), ".clawde", "config", "clawde.toml");
}

function readTomlSafe(path: string): Record<string, unknown> {
  try {
    const raw = readFileSync(path, "utf-8");
    return parseTOML(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Computa origem por campo. Precedência: env > toml > default.
 *
 * Caminha leaves do `resolved` (já validado pelo zod) e, pra cada path
 * dotted:
 *  - "env" se algum ENV_PATH_MAP aponta pro path E o env var está setado
 *    com valor não-vazio (mesma regra de load.ts).
 *  - "toml" se o path existe no `rawToml`.
 *  - "default" caso contrário.
 *
 * Arrays são tratados como folhas (não digging into elementos individuais).
 */
function computeFieldSources(
  resolved: Record<string, unknown>,
  rawToml: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Record<string, ConfigOrigin> {
  const out: Record<string, ConfigOrigin> = {};
  walkLeaves(resolved, [], (flatPath) => {
    if (isEnvOverride(flatPath, env)) {
      out[flatPath] = "env";
      return;
    }
    if (existsAtTomlPath(rawToml, flatPath.split("."))) {
      out[flatPath] = "toml";
      return;
    }
    out[flatPath] = "default";
  });
  return out;
}

function isEnvOverride(flatPath: string, env: Record<string, string | undefined>): boolean {
  for (const [envKey, configPath] of Object.entries(ENV_PATH_MAP)) {
    if (configPath !== flatPath) continue;
    const value = env[envKey];
    if (value !== undefined && value !== "") return true;
  }
  return false;
}

function walkLeaves(
  obj: Record<string, unknown>,
  path: ReadonlyArray<string>,
  visit: (flatPath: string) => void,
): void {
  for (const [key, value] of Object.entries(obj)) {
    const newPath = [...path, key];
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      walkLeaves(value as Record<string, unknown>, newPath, visit);
    } else {
      visit(newPath.join("."));
    }
  }
}

function existsAtTomlPath(obj: unknown, path: ReadonlyArray<string>): boolean {
  let cursor: unknown = obj;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return false;
    if (!(key in (cursor as Record<string, unknown>))) return false;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return true;
}

// Re-export schema pra debug se preciso, e suprime warning de unused.
export const _schemaRef: typeof ClawdeConfigSchema = ClawdeConfigSchema;
