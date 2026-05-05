import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runBinary(
  binaryPath: string,
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined>,
): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync([binaryPath, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

describe("compiled cli smoke-test", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-smoke-bin-"));
    const configPath = join(dir, "clawde.toml");
    writeFileSync(configPath, `[clawde]\nhome = "${dir}"\nlog_level = "INFO"\n`, "utf-8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test(
    "smoke-test via binary compilado encontra migrations e retorna overall OK",
    () => {
      const binaryPath = join(tmpdir(), `clawde-smoke-bin-${Date.now()}`);
      const bunBin = Bun.which("bun") ?? process.execPath;
      const build = Bun.spawnSync(
        [bunBin, "build", "src/cli/main.ts", "--compile", "--outfile", binaryPath],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(build.exitCode).toBe(0);

      const env = {
        ...(process.env as Record<string, string | undefined>),
        CLAWDE_CONFIG: join(dir, "clawde.toml"),
      };

      const migrate = runBinary(binaryPath, ["migrate", "up"], env);
      expect(migrate.exitCode).toBe(0);

      const smoke = runBinary(binaryPath, ["smoke-test", "--output", "text"], env);
      expect(smoke.exitCode).toBe(0);
      expect(smoke.stdout).toContain("[OK ] db.migrations");
      expect(smoke.stdout).toContain("overall: OK");
    },
    { timeout: 30_000 },
  );
});
