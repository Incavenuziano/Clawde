import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentDefinitionError,
  loadAgentDefinition,
  loadAllAgentDefinitions,
  loadAllAgentDefinitionsWithWarnings,
  parseAgentFrontmatter,
} from "@clawde/agents";

function writeAgent(agentDir: string, frontmatter: string, body = "system prompt"): void {
  writeFileSync(join(agentDir, "AGENT.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

describe("agents/loader parseAgentFrontmatter", () => {
  test("AGENT.md sem frontmatter inicial falha com erro claro", () => {
    expect(() => parseAgentFrontmatter("# sem frontmatter")).toThrow(
      /must start with frontmatter delimiter/,
    );
  });
});

describe("agents/loader loadAgentDefinition", () => {
  const cleanups: string[] = [];

  afterEach(() => {
    for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("AGENT.md sem name falha com erro zod claro", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawde-agent-"));
    cleanups.push(dir);
    writeAgent(
      dir,
      [
        'role: "role"',
        "model: sonnet",
        "allowedTools: [Read]",
        "disallowedTools: []",
        "maxTurns: 5",
        "sandboxLevel: 1",
        "requiresWorkspace: false",
      ].join("\n"),
    );
    expect(() => loadAgentDefinition(dir)).toThrow(/invalid AGENT\.md frontmatter/);
  });

  test("carrega definição válida", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawde-agent-"));
    cleanups.push(dir);
    writeAgent(
      dir,
      [
        "name: implementer",
        'role: "Implementa tarefas"',
        "model: sonnet",
        "allowedTools: [Read, Edit, Write]",
        "disallowedTools: [WebFetch]",
        "maxTurns: 12",
        "sandboxLevel: 2",
        "requiresWorkspace: true",
      ].join("\n"),
      "Você implementa mudanças.",
    );
    writeFileSync(join(dir, "sandbox.toml"), 'level = 2\nallowed_writes = ["/workspace"]\n');

    const def = loadAgentDefinition(dir);
    expect(def.name).toBe("implementer");
    expect(def.frontmatter.maxTurns).toBe(12);
    expect(def.frontmatter.allowedTools).toEqual(["Read", "Edit", "Write"]);
    expect(def.sandbox.level).toBe(2);
    expect(def.sandbox.allowed_writes).toEqual(["/workspace"]);
    expect(def.systemPrompt).toContain("Você implementa");
  });
});

describe("agents/loader loadAllAgentDefinitions", () => {
  const cleanups: string[] = [];

  afterEach(() => {
    for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("retorna agentes ordenados por nome", () => {
    const root = mkdtempSync(join(tmpdir(), "clawde-agents-"));
    cleanups.push(root);
    const beta = join(root, "beta");
    const alpha = join(root, "alpha");
    mkdirSync(beta);
    mkdirSync(alpha);
    writeAgent(
      beta,
      [
        "name: beta",
        'role: "beta"',
        "model: sonnet",
        "allowedTools: [Read]",
        "disallowedTools: []",
        "maxTurns: 5",
        "sandboxLevel: 1",
        "requiresWorkspace: false",
      ].join("\n"),
    );
    writeAgent(
      alpha,
      [
        "name: alpha",
        'role: "alpha"',
        "model: sonnet",
        "allowedTools: [Read]",
        "disallowedTools: []",
        "maxTurns: 5",
        "sandboxLevel: 1",
        "requiresWorkspace: false",
      ].join("\n"),
    );
    const defs = loadAllAgentDefinitions(root);
    expect(defs.map((d) => d.name)).toEqual(["alpha", "beta"]);
  });

  test("AGENT.md ausente lança AgentDefinitionError", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawde-agent-"));
    cleanups.push(dir);
    expect(() => loadAgentDefinition(dir)).toThrow(AgentDefinitionError);
  });

  test("emite warning quando agent declara Bash com sandbox level >= 2", () => {
    const root = mkdtempSync(join(tmpdir(), "clawde-agents-"));
    cleanups.push(root);
    const impl = join(root, "implementer");
    mkdirSync(impl);
    writeAgent(
      impl,
      [
        "name: implementer",
        'role: "Implementa"',
        "model: sonnet",
        "allowedTools: [Read, Bash]",
        "disallowedTools: []",
        "maxTurns: 10",
        "sandboxLevel: 2",
        "requiresWorkspace: true",
      ].join("\n"),
    );
    writeFileSync(join(impl, "sandbox.toml"), 'level = 2\nnetwork = "none"\n');

    const warnings: Array<{
      kind: string;
      agentName: string;
      sandboxLevel: number;
    }> = [];
    const defs = loadAllAgentDefinitionsWithWarnings(root, {
      onWarning: (warning) => warnings.push(warning),
    });
    expect(defs).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "bash_disallowed_by_sandbox_level",
      agentName: "implementer",
      sandboxLevel: 2,
    });
  });
});
