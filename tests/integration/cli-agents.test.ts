import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "@clawde/cli/main";

async function captureOutput<T>(fn: () => Promise<T>): Promise<{
  readonly out: string;
  readonly err: string;
  readonly value: T;
}> {
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = ((chunk: unknown): boolean => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    err += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const value = await fn();
    return { out, err, value };
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
}

function writeAgent(agentDir: string, name: string): void {
  writeFileSync(
    join(agentDir, "AGENT.md"),
    `---
name: ${name}
role: "role"
model: sonnet
allowedTools: [Read, Grep]
disallowedTools: []
maxTurns: 7
sandboxLevel: 1
requiresWorkspace: false
---

system prompt
`,
  );
}

describe("cli agents", () => {
  const cleanups: string[] = [];

  afterEach(() => {
    process.env.CLAWDE_CONFIG = undefined;
    for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
  });

  test("agents list --output json retorna campos esperados", async () => {
    const home = mkdtempSync(join(tmpdir(), "clawde-home-"));
    cleanups.push(home);
    const agentsRoot = join(home, "agents");
    mkdirSync(join(agentsRoot, "alpha"), { recursive: true });
    writeAgent(join(agentsRoot, "alpha"), "alpha");
    writeFileSync(join(home, "clawde.toml"), `[clawde]\nhome = "${home}"\nlog_level = "INFO"\n`);
    process.env.CLAWDE_CONFIG = join(home, "clawde.toml");

    const res = await captureOutput(() => runMain(["agents", "list", "--output", "json"]));
    expect(res.value).toBe(0);
    const parsed = JSON.parse(res.out) as {
      agents: Array<{
        name: string;
        model: string;
        sandboxLevel: number;
        allowedToolsCount: number;
      }>;
    };
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0]?.name).toBe("alpha");
    expect(parsed.agents[0]?.model).toBe("sonnet");
    expect(parsed.agents[0]?.sandboxLevel).toBe(1);
    expect(parsed.agents[0]?.allowedToolsCount).toBe(2);
  });
});
