import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, DEFAULT_CONFIG, loadConfig } from "@clawde/config";

describe("config/load defaults (sem arquivo)", () => {
  test("retorna DEFAULT_CONFIG quando arquivo inexistente", () => {
    const cfg = loadConfig({ path: "/nonexistent/clawde.toml", env: {} });
    expect(cfg.clawde.log_level).toBe("INFO");
    expect(cfg.worker.max_parallel).toBe(1);
    expect(cfg.quota.plan).toBe("max5x");
    expect(cfg.quota.thresholds.aviso).toBe(60);
  });

  test("DEFAULT_CONFIG tem mesmos valores", () => {
    expect(DEFAULT_CONFIG.clawde.log_level).toBe("INFO");
    expect(DEFAULT_CONFIG.worker.cli_min_version).toBe("2.0.0");
  });
});

describe("config/load arquivo TOML válido", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-config-"));
    path = join(dir, "clawde.toml");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("parse mínimo aplica overrides", () => {
    writeFileSync(
      path,
      `
[clawde]
log_level = "DEBUG"

[worker]
max_parallel = 4
`,
    );
    const cfg = loadConfig({ path, env: {} });
    expect(cfg.clawde.log_level).toBe("DEBUG");
    expect(cfg.worker.max_parallel).toBe(4);
    // Não-mencionados ficam com default.
    expect(cfg.worker.cli_path).toBe("/usr/local/bin/claude");
  });

  test("config-example completo é válido", () => {
    const examplePath = join(import.meta.dirname, "../../../deploy/config-example/clawde.toml");
    const cfg = loadConfig({ path: examplePath, env: {} });
    expect(cfg.quota.plan).toBe("max5x");
    expect(cfg.quota.peak_multiplier).toBe(1.7);
    expect(cfg.sandbox.default_level).toBe(1);
  });

  test("valor inválido lança ConfigError com path", () => {
    writeFileSync(
      path,
      `
[quota]
plan = "invalid-plan"
`,
    );
    try {
      loadConfig({ path, env: {} });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.message).toContain("quota.plan");
      expect(ce.issues.length).toBeGreaterThan(0);
    }
  });

  test("TOML sintaticamente inválido lança ConfigError", () => {
    writeFileSync(path, "this is not [valid TOML]\n=====");
    expect(() => loadConfig({ path, env: {} })).toThrow(ConfigError);
  });
});

describe("config/load env overrides", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-config-"));
    path = join(dir, "clawde.toml");
    writeFileSync(path, `[clawde]\nlog_level = "INFO"\n`);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("CLAWDE_LOG_LEVEL sobrescreve TOML", () => {
    const cfg = loadConfig({ path, env: { CLAWDE_LOG_LEVEL: "WARN" } });
    expect(cfg.clawde.log_level).toBe("WARN");
  });

  test("CLAWDE_QUOTA_PLAN sobrescreve plano", () => {
    const cfg = loadConfig({ path, env: { CLAWDE_QUOTA_PLAN: "max20x" } });
    expect(cfg.quota.plan).toBe("max20x");
  });

  test("CLAWDE_CONFIG resolve path quando options.path ausente", () => {
    const cfg = loadConfig({ env: { CLAWDE_CONFIG: path, CLAWDE_LOG_LEVEL: "ERROR" } });
    expect(cfg.clawde.log_level).toBe("ERROR");
  });

  test("env vazia não sobrescreve", () => {
    const cfg = loadConfig({ path, env: { CLAWDE_LOG_LEVEL: "" } });
    expect(cfg.clawde.log_level).toBe("INFO");
  });
});
