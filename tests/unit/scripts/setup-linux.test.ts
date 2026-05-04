import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts/setup-linux.sh");

interface ScriptRunResult {
  readonly exitCode: number;
  readonly configPath: string;
  readonly configText: string;
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function runSetupLinux(initialConfig: string): ScriptRunResult {
  const root = mkdtempSync(join(tmpdir(), "clawde-setup-linux-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const configDir = join(home, ".clawde/config");
  const configPath = join(configDir, "clawde.toml");

  try {
    Bun.spawnSync(["mkdir", "-p", bin, configDir], { stderr: "inherit" });
    writeExecutable(join(bin, "bun"), "#!/usr/bin/env bash\nexit 1\n");
    writeExecutable(join(bin, "claude"), "#!/usr/bin/env bash\necho claude\n");
    writeFileSync(configPath, initialConfig);

    const result = Bun.spawnSync(["bash", SCRIPT_PATH], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      exitCode: result.exitCode,
      configPath,
      configText: readFileSync(configPath, "utf-8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function countWorkerSections(toml: string): number {
  return (toml.match(/^\[worker\]\s*$/gm) ?? []).length;
}

describe("scripts/setup-linux.sh", () => {
  test("insere chave ativa quando só há comentário e não duplica [worker]", () => {
    const initial = `[worker]
max_parallel = 1
# claude_executable_path = "~/.clawde/bin/claude"
`;

    const result = runSetupLinux(initial);
    expect(result.exitCode).toBe(0);
    expect(countWorkerSections(result.configText)).toBe(1);
    expect(result.configText).toContain('claude_executable_path = "');
    expect(result.configText).toContain("# claude_executable_path = ");
  });

  test("quando [worker] existe sem chave, não cria segundo bloco [worker]", () => {
    const initial = `[worker]
max_parallel = 1

[quota]
plan = "max5x"
`;

    const result = runSetupLinux(initial);
    expect(result.exitCode).toBe(0);
    expect(countWorkerSections(result.configText)).toBe(1);
    expect(result.configText).toContain('claude_executable_path = "');
  });

  test("idempotente: segunda execução não duplica chave", () => {
    const initial = `[worker]
max_parallel = 1
`;

    const first = runSetupLinux(initial);
    expect(first.exitCode).toBe(0);

    const second = runSetupLinux(first.configText);
    expect(second.exitCode).toBe(0);
    expect((second.configText.match(/^\s*claude_executable_path\s*=/gm) ?? []).length).toBe(1);
    expect(countWorkerSections(second.configText)).toBe(1);
  });
});
