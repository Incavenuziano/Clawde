/**
 * Loader de configuração:
 *   1. Lê CLAWDE_CONFIG ou ~/.clawde/config/clawde.toml.
 *   2. Parse TOML.
 *   3. Aplica override por env vars (CLAWDE_LOG_LEVEL etc).
 *   4. Valida via zod (falha = erro com path + mensagem).
 */

import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseTOML } from "smol-toml";
import { z } from "zod";
import { type ClawdeConfig, ClawdeConfigSchema } from "./schema.ts";

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

const ENV_OVERRIDES: ReadonlyArray<{ env: string; path: string[] }> = [
  { env: "CLAWDE_LOG_LEVEL", path: ["clawde", "log_level"] },
  { env: "CLAWDE_HOME", path: ["clawde", "home"] },
  { env: "CLAWDE_CLI_PATH", path: ["worker", "cli_path"] },
  { env: "CLAWDE_QUOTA_PLAN", path: ["quota", "plan"] },
];

export interface LoadConfigOptions {
  readonly path?: string;
  readonly env?: Record<string, string | undefined>;
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return p.replace(/^~/, homedir());
  }
  return p;
}

function resolveConfigPath(env: Record<string, string | undefined>, override?: string): string {
  if (override !== undefined) return expandHome(override);
  if (env.CLAWDE_CONFIG !== undefined) return expandHome(env.CLAWDE_CONFIG);
  return join(homedir(), ".clawde", "config", "clawde.toml");
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: string): void {
  let cursor = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (key === undefined) return;
    const next = cursor[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const finalKey = path[path.length - 1];
  if (finalKey === undefined) return;
  cursor[finalKey] = value;
}

/**
 * Lê + parseia TOML; vazio se arquivo não existir.
 */
function readTomlOrEmpty(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf-8");
  try {
    const parsed = parseTOML(raw);
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new ConfigError(
      `failed to parse TOML at ${path}: ${(err as Error).message}`,
    );
  }
}

/**
 * Carrega config aplicando precedência env > toml > defaults (zod).
 */
export function loadConfig(options: LoadConfigOptions = {}): ClawdeConfig {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const path = resolveConfigPath(env, options.path);

  const raw = readTomlOrEmpty(path);

  for (const { env: envKey, path: configPath } of ENV_OVERRIDES) {
    const value = env[envKey];
    if (value !== undefined && value !== "") {
      setNestedValue(raw, configPath, value);
    }
  }

  const result = ClawdeConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    const summary = issues.map((i) => `  ${i.path || "<root>"}: ${i.message}`).join("\n");
    throw new ConfigError(`invalid config at ${path}:\n${summary}`, issues);
  }
  return result.data;
}

/**
 * Apenas pra debug/diagnose: serializa config como JSON pretty.
 */
export function configToJson(config: ClawdeConfig): string {
  return JSON.stringify(config, null, 2);
}

export { z };
