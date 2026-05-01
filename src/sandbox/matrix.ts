/**
 * F4.T59 — Matriz de sandbox: dispatcher que decide nível + monta BwrapConfig
 * a partir de AgentSandboxConfig + workspace path.
 *
 * Nível 1: systemd hardening only (sem bwrap). materializeSandbox retorna
 *   "level": 1 com runDirect = true; chamador usa execFile direto.
 *
 * Nível 2: bwrap com bind read-only de /usr|/lib|/etc/ssl, RW só do worktree.
 *   network='allowlist' falha fechada até backend nftables existir (P2.6).
 *
 * Nível 3: bwrap nivel 2 + applyNetnsToConfig (loopback-only, custom resolv.conf).
 */

import { sendAlertBestEffort } from "@clawde/alerts";
import type { AgentSandboxConfig } from "./agent-config.ts";
import type { BwrapConfig, SandboxLevel } from "./bwrap.ts";
import { applyNetnsToConfig, generateLoopbackResolvConf } from "./netns.ts";

export interface MaterializeInput {
  /** Config do agente (do .clawde/agents/<name>/sandbox.toml). */
  readonly agent: AgentSandboxConfig;
  /** Path absoluto do workspace ephemeral. */
  readonly workspacePath: string;
  /** Path do diretório de state pra arquivos auxiliares (resolv.conf etc). */
  readonly stateDir: string;
  /** Override do bwrap path (default /usr/bin/bwrap). */
  readonly bwrapPath?: string;
}

export interface MaterializedSandbox {
  readonly level: SandboxLevel;
  /** Se true, executar direto (sem bwrap) — Nível 1 puro systemd. */
  readonly runDirect: boolean;
  /** Config bwrap pronto para runBwrapped(). Null se runDirect=true. */
  readonly bwrap: BwrapConfig | null;
}

/**
 * Materializa sandbox para uso no worker.
 */
export function materializeSandbox(input: MaterializeInput): MaterializedSandbox {
  try {
    if (input.agent.level === 1) {
      return { level: 1, runDirect: true, bwrap: null };
    }

    // Base config nivel 2.
    const baseConfig: BwrapConfig = {
      bwrapPath: input.bwrapPath ?? "/usr/bin/bwrap",
      readOnlyMounts: [...input.agent.read_only_mounts],
      readWritePaths: [
        // Worktree ephemeral é o único path RW.
        { host: input.workspacePath, sandbox: "/workspace" },
      ],
      network: input.agent.network,
      allowlistBackendAvailable: false,
      workdir: "/workspace",
      env: {
        HOME: "/workspace",
        PATH: "/usr/bin:/bin",
        LANG: "C.UTF-8",
      },
    };

    if (input.agent.level === 2) {
      return { level: 2, runDirect: false, bwrap: baseConfig };
    }

    // Nível 3: aplica netns isolation.
    const resolvConfPath = generateLoopbackResolvConf(input.stateDir);
    const netnsConfig = applyNetnsToConfig(baseConfig, {
      allowedEgress: input.agent.allowed_egress,
      resolvConfPath,
    });
    return { level: 3, runDirect: false, bwrap: netnsConfig };
  } catch (err) {
    void sendAlertBestEffort({
      severity: "high",
      trigger: "sandbox_violation",
      cooldownKey: "sandbox_violation",
      payload: {
        error: (err as Error).message,
        level: input.agent.level,
        network: input.agent.network,
      },
    });
    throw err;
  }
}

/**
 * Decisão de bypass: agentes "trusted" como reflector podem rodar com level
 * baixo mesmo se sandbox.toml não existir. Helper exposto para reutilização.
 */
export function defaultLevelForAgent(agentName: string): SandboxLevel {
  // Agentes com input externo não-confiável precisam nivel 3.
  if (agentName === "telegram-bot" || agentName === "github-pr-handler") {
    return 3;
  }
  // Agentes com Bash livre precisam nivel 2.
  if (agentName === "implementer" || agentName === "debugger") {
    return 2;
  }
  // Demais: nivel 1.
  return 1;
}
