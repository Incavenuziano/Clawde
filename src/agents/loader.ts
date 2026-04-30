import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type AgentSandboxConfig, loadAgentSandbox } from "@clawde/sandbox";
import { z } from "zod";

const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_:-]*$/;

export const AgentFrontmatterSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    role: z.string().min(1),
    model: z.enum(["sonnet", "opus", "haiku", "inherit"]).default("inherit"),
    allowedTools: z.array(z.string().regex(TOOL_NAME_RE)).default([]),
    disallowedTools: z.array(z.string().regex(TOOL_NAME_RE)).default([]),
    maxTurns: z.number().int().positive().default(15),
    sandboxLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    requiresWorkspace: z.boolean().default(false),
  })
  .passthrough();

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

export interface AgentDefinition {
  readonly name: string;
  readonly dir: string;
  readonly frontmatter: AgentFrontmatter;
  readonly systemPrompt: string;
  readonly sandbox: AgentSandboxConfig;
}

export interface AgentPolicyWarning {
  readonly kind: "bash_disallowed_by_sandbox_level";
  readonly agentName: string;
  readonly agentDir: string;
  readonly sandboxLevel: number;
}

export class AgentDefinitionError extends Error {
  constructor(
    message: string,
    public readonly agentPath: string,
  ) {
    super(message);
    this.name = "AgentDefinitionError";
  }
}

function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseInlineArray(raw: string): ReadonlyArray<unknown> {
  const body = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (body.length === 0) return [];
  return body
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => parseScalar(item));
}

function parseFrontmatterYaml(frontmatter: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(trimmed);
    if (match === null) continue;
    const key = match[1];
    if (key === undefined) continue;
    const value = match[2] ?? "";
    if (value === "|") {
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next === undefined) continue;
        if (!next.startsWith(" ")) break;
        block.push(next.replace(/^ /, ""));
        i = j;
      }
      out[key] = block.join("\n");
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      out[key] = parseInlineArray(value);
      continue;
    }
    out[key] = parseScalar(value);
  }
  return out;
}

export function parseAgentFrontmatter(content: string): {
  readonly frontmatter: string;
  readonly body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("AGENT.md must start with frontmatter delimiter '---'");
  }
  const closeIdx = normalized.indexOf("\n---\n", 4);
  if (closeIdx < 0) {
    throw new Error("AGENT.md frontmatter closing delimiter '---' not found");
  }
  const frontmatter = normalized.slice(4, closeIdx);
  const body = normalized.slice(closeIdx + 5).trim();
  return { frontmatter, body };
}

export function loadAgentDefinition(agentDir: string): AgentDefinition {
  const agentPath = join(agentDir, "AGENT.md");
  if (!existsSync(agentPath)) {
    throw new AgentDefinitionError("AGENT.md not found", agentPath);
  }
  const raw = readFileSync(agentPath, "utf-8");

  let parsed: { frontmatter: string; body: string };
  try {
    parsed = parseAgentFrontmatter(raw);
  } catch (err) {
    throw new AgentDefinitionError((err as Error).message, agentPath);
  }

  const fm = parseFrontmatterYaml(parsed.frontmatter);
  const validated = AgentFrontmatterSchema.safeParse(fm);
  if (!validated.success) {
    const summary = validated.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new AgentDefinitionError(`invalid AGENT.md frontmatter: ${summary}`, agentPath);
  }

  return {
    name: validated.data.name,
    dir: agentDir,
    frontmatter: validated.data,
    systemPrompt: parsed.body,
    sandbox: loadAgentSandbox(agentDir),
  };
}

export function loadAllAgentDefinitions(agentsRoot: string): ReadonlyArray<AgentDefinition> {
  return loadAllAgentDefinitionsWithWarnings(agentsRoot);
}

export function loadAllAgentDefinitionsWithWarnings(
  agentsRoot: string,
  options?: {
    readonly onWarning?: (warning: AgentPolicyWarning) => void;
  },
): ReadonlyArray<AgentDefinition> {
  if (!existsSync(agentsRoot)) return [];
  const defs: AgentDefinition[] = [];
  for (const entry of readdirSync(agentsRoot)) {
    const dir = join(agentsRoot, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const def = loadAgentDefinition(dir);
    if (def.frontmatter.allowedTools.includes("Bash") && def.sandbox.level >= 2) {
      options?.onWarning?.({
        kind: "bash_disallowed_by_sandbox_level",
        agentName: def.name,
        agentDir: dir,
        sandboxLevel: def.sandbox.level,
      });
    }
    defs.push(def);
  }
  defs.sort((a, b) => a.name.localeCompare(b.name));
  return defs;
}
