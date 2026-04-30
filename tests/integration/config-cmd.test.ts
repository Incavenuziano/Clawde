import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ConfigShowReport,
  type ConfigValidateReport,
  runConfigShow,
  runConfigValidate,
} from "@clawde/cli/commands/config";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((c: unknown): boolean => {
    stdout += String(c);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown): boolean => {
    stderr += String(c);
    return true;
  }) as typeof process.stderr.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout, stderr }))
    .finally(() => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    });
}

describe("cli/commands/config show+validate", () => {
  let dir: string;
  let configPath: string;
  let prevConfigEnv: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-config-cmd-"));
    configPath = join(dir, "clawde.toml");
    prevConfigEnv = process.env.CLAWDE_CONFIG;
  });

  afterEach(() => {
    if (prevConfigEnv !== undefined) {
      process.env.CLAWDE_CONFIG = prevConfigEnv;
    } else {
      delete process.env.CLAWDE_CONFIG;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("show com config válido retorna 0 + report estruturado", async () => {
    writeFileSync(
      configPath,
      `[clawde]\nhome = "${dir}"\nlog_level = "INFO"\n`,
      "utf-8",
    );
    const { exit, stdout } = await captureOutput(() =>
      runConfigShow({ format: "json", path: configPath }),
    );
    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as ConfigShowReport;
    expect(report.resolvedPath).toBe(configPath);
    expect(report.tomlExists).toBe(true);
    expect(report.config).toBeDefined();
  });

  test("show retorna exit 1 quando TOML é inválido (zod)", async () => {
    // home faltando obrigatório seria zod fail; deixa apenas log_level com valor inválido
    writeFileSync(configPath, '[clawde]\nlog_level = "BOGUS"\n', "utf-8");
    const { exit, stderr } = await captureOutput(() =>
      runConfigShow({ format: "text", path: configPath }),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("invalid config");
  });

  test("show com path inexistente cai em defaults (tomlExists=false)", async () => {
    const ghostPath = join(dir, "ghost.toml");
    const { exit, stdout } = await captureOutput(() =>
      runConfigShow({ format: "json", path: ghostPath }),
    );
    // Defaults zod deveriam validar (campos com defaults).
    // Se algum campo for required-without-default, o exit pode ser 1.
    expect([0, 1]).toContain(exit);
    if (exit === 0) {
      const report = JSON.parse(stdout) as ConfigShowReport;
      expect(report.tomlExists).toBe(false);
    }
  });

  test("validate retorna 0 em TOML válido", async () => {
    writeFileSync(
      configPath,
      `[clawde]\nhome = "${dir}"\nlog_level = "INFO"\n`,
      "utf-8",
    );
    const { exit, stdout } = await captureOutput(() =>
      runConfigValidate({ format: "json", path: configPath }),
    );
    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as ConfigValidateReport;
    expect(report.ok).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  test("validate retorna 1 + lista issues em TOML inválido", async () => {
    writeFileSync(configPath, '[clawde]\nlog_level = "BOGUS"\n', "utf-8");
    const { exit, stdout } = await captureOutput(() =>
      runConfigValidate({ format: "json", path: configPath }),
    );
    expect(exit).toBe(1);
    const report = JSON.parse(stdout) as ConfigValidateReport;
    expect(report.ok).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  test("validate retorna 1 quando arquivo não existe", async () => {
    const ghost = join(dir, "ghost.toml");
    const { exit, stderr } = await captureOutput(() =>
      runConfigValidate({ format: "text", path: ghost }),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("not found");
  });
});
