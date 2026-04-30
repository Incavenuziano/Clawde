/**
 * `clawde config show|validate <path>` — visibility e validação da
 * configuração resolved. Sub-fase P3.2 (T-109, T-110).
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ClawdeConfigSchema } from "@clawde/config";
import { ConfigError, loadConfig } from "@clawde/config";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface ConfigShowOptions {
  readonly format: OutputFormat;
  readonly path?: string;
}

export interface ConfigValidateOptions {
  readonly format: OutputFormat;
  readonly path: string;
}

export interface ConfigSource {
  readonly origin: "default" | "toml" | "env";
  readonly key: string;
}

export interface ConfigShowReport {
  readonly resolvedPath: string;
  readonly tomlExists: boolean;
  readonly envOverrides: ReadonlyArray<string>;
  readonly config: unknown;
}

const ENV_KEYS = [
  "CLAWDE_CONFIG",
  "CLAWDE_LOG_LEVEL",
  "CLAWDE_HOME",
  "CLAWDE_CLI_PATH",
  "CLAWDE_QUOTA_PLAN",
] as const;

export function runConfigShow(options: ConfigShowOptions): number {
  try {
    const resolvedPath = resolveExplicitPath(options.path);
    const config = loadConfig(options.path !== undefined ? { path: options.path } : {});
    const envOverrides = ENV_KEYS.filter(
      (k) => process.env[k] !== undefined && process.env[k] !== "",
    );
    const report: ConfigShowReport = {
      resolvedPath,
      tomlExists: existsSync(resolvedPath),
      envOverrides,
      config,
    };
    emit(options.format, report, (d) => {
      const r = d as ConfigShowReport;
      const lines = [
        `resolved path:  ${r.resolvedPath}${r.tomlExists ? "" : " (not found — using defaults)"}`,
        `env overrides:  ${r.envOverrides.length === 0 ? "(none)" : r.envOverrides.join(", ")}`,
        "",
        JSON.stringify(r.config, null, 2),
      ];
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

// Re-export schema pra debug se preciso, e suprime warning de unused.
export const _schemaRef: typeof ClawdeConfigSchema = ClawdeConfigSchema;
