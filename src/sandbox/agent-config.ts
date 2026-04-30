/**
 * F4.T58 — Loader de `.clawde/agents/<name>/sandbox.toml`.
 *
 * Schema validado via zod. Defaults razoáveis pra ausentes.
 * Erros (TOML inválido, fields com tipo errado) lançam SandboxConfigError tipado.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseTOML } from "smol-toml";
import { z } from "zod";
import type { SandboxLevel } from "./bwrap.ts";

// Mantemos "allowlist" no schema por compatibilidade de config.
// Em runtime (P2.6), bwrap falha fechada até backend nftables existir.
export const NetworkModeSchema = z.enum(["allowlist", "loopback-only", "none", "host"]);

export const SandboxLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const AgentSandboxSchema = z.object({
  level: SandboxLevelSchema.default(1),
  network: NetworkModeSchema.default("none"),
  allowed_egress: z.array(z.string()).default([]),
  allowed_writes: z.array(z.string()).default([]),
  /**
   * Path allowlist para `Read` tool no `PreToolUse` hook.
   * - Omitido (`undefined`): comportamento legacy permissivo (read libera-tudo).
   * - Definido como `[]`: fail-closed, nenhum read permitido (use pra
   *   agentes que processam input adversarial com auto-resposta).
   * - Lista não-vazia: strict allowlist por path prefix.
   */
  allowed_reads: z.array(z.string()).optional(),
  read_only_mounts: z.array(z.string()).default([]),
  max_memory_mb: z.number().int().positive().default(1024),
  max_cpu_seconds: z.number().int().positive().default(600),
});

export type AgentSandboxConfig = z.infer<typeof AgentSandboxSchema>;

export class SandboxConfigError extends Error {
  constructor(
    message: string,
    public readonly agentPath: string,
  ) {
    super(message);
    this.name = "SandboxConfigError";
  }
}

/**
 * Carrega config de 1 agente por path. Se sandbox.toml não existir, retorna
 * defaults (level=1).
 */
export function loadAgentSandbox(agentDir: string): AgentSandboxConfig {
  const path = join(agentDir, "sandbox.toml");
  if (!existsSync(path)) {
    return AgentSandboxSchema.parse({});
  }
  let raw: Record<string, unknown>;
  try {
    raw = parseTOML(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new SandboxConfigError(`failed to parse TOML: ${(err as Error).message}`, path);
  }
  const result = AgentSandboxSchema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new SandboxConfigError(`invalid sandbox.toml: ${summary}`, path);
  }
  return result.data;
}

export interface AgentDefinition {
  readonly name: string;
  readonly dir: string;
  readonly sandbox: AgentSandboxConfig;
}

/**
 * Carrega TODOS os agentes em `.clawde/agents/`. Cada subdir é um agent name;
 * sandbox.toml dentro dele é a config. Agentes sem sandbox.toml usam defaults.
 *
 * Retorna lista ordenada por nome.
 */
export function loadAllAgents(agentsRoot: string): ReadonlyArray<AgentDefinition> {
  if (!existsSync(agentsRoot)) return [];
  const out: AgentDefinition[] = [];
  for (const entry of readdirSync(agentsRoot)) {
    const dir = join(agentsRoot, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const sandbox = loadAgentSandbox(dir);
    out.push({ name: entry, dir, sandbox });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Helper: encontra config por nome. Retorna defaults se não existir.
 */
export function findAgentSandbox(agentsRoot: string, agentName: string): AgentSandboxConfig {
  const dir = join(agentsRoot, agentName);
  return loadAgentSandbox(dir);
}

export type { SandboxLevel };
