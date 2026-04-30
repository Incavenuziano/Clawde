/**
 * F4.T56 — Bubblewrap (bwrap) wrapper para Sandbox Nível 2 (ADR 0005).
 *
 * Constrói args de bwrap a partir de SandboxConfig e executa comando via
 * spawn. Bind mounts read-only do sistema (/usr, /lib, /etc/ssl) + 1 RW path
 * pro workspace ephemeral. Capabilities/namespaces dropados; rede opcional.
 *
 * Linux only. macOS perde Nível 2 (bwrap não existe nativo).
 */

import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { existsSync } from "node:fs";

export type SandboxLevel = 1 | 2 | 3;

export type NetworkMode = "allowlist" | "loopback-only" | "none" | "host";

export interface BwrapConfig {
  /** Caminho do binário bwrap. Default: /usr/bin/bwrap. */
  readonly bwrapPath?: string;
  /** Path host → bind read-only no sandbox (mesma path interna). */
  readonly readOnlyMounts: ReadonlyArray<string>;
  /** Path host → mount read-write. Tipicamente o workspace ephemeral. */
  readonly readWritePaths: ReadonlyArray<{ host: string; sandbox: string }>;
  /** Modo de rede. */
  readonly network: NetworkMode;
  /**
   * Backend real de allowlist (nftables/netns) disponível.
   * Enquanto false/undefined, network='allowlist' falha fechada.
   */
  readonly allowlistBackendAvailable?: boolean;
  /** Working directory dentro do sandbox. */
  readonly workdir?: string;
  /** Variáveis de ambiente (passadas pra bwrap --setenv). */
  readonly env?: Readonly<Record<string, string>>;
}

export const DEFAULT_BWRAP_PATH = "/usr/bin/bwrap";

/**
 * Mounts comuns para qualquer nível 2+. Distros podem variar; checamos
 * existência antes de adicionar à lista.
 */
const COMMON_RO_MOUNTS = [
  "/usr",
  "/bin",
  "/lib",
  "/lib64",
  "/etc/ssl",
  "/etc/ca-certificates",
  "/etc/resolv.conf",
];

export function isBwrapAvailable(bwrapPath = DEFAULT_BWRAP_PATH): boolean {
  return existsSync(bwrapPath);
}

/**
 * Constrói args do bwrap a partir de BwrapConfig + comando alvo.
 * Útil pra inspeção/testes; quem executa é runBwrapped().
 */
export function buildBwrapArgs(
  config: BwrapConfig,
  command: string,
  commandArgs: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const args: string[] = [];

  // Read-only mounts comuns que existirem.
  for (const path of COMMON_RO_MOUNTS) {
    if (existsSync(path)) {
      args.push("--ro-bind", path, path);
    }
  }
  // Read-only mounts custom do config.
  for (const path of config.readOnlyMounts) {
    if (existsSync(path)) {
      args.push("--ro-bind", path, path);
    }
  }

  // Read-write mounts.
  for (const { host, sandbox } of config.readWritePaths) {
    args.push("--bind", host, sandbox);
  }

  // /proc + /dev minimal.
  args.push("--proc", "/proc");
  args.push("--dev", "/dev");

  // Namespaces: unshare tudo.
  args.push("--unshare-all");

  // Rede.
  if (config.network === "host") {
    args.push("--share-net");
  } else if (config.network === "allowlist") {
    if (config.allowlistBackendAvailable !== true) {
      throw new Error(
        "network='allowlist' requires nftables backend not yet implemented. Use 'host' explicitly.",
      );
    }
    args.push("--share-net");
  }
  // 'loopback-only' e 'none' = mantém net unshared. loopback exists by default
  // dentro do new netns (lo só, sem rotas externas).

  // Sandbox seguro: não escala privilégios.
  args.push("--die-with-parent");
  args.push("--new-session");

  // Working directory.
  if (config.workdir !== undefined) {
    args.push("--chdir", config.workdir);
  }

  // Env vars: limpa tudo e passa só as desejadas.
  args.push("--clearenv");
  if (config.env !== undefined) {
    for (const [k, v] of Object.entries(config.env)) {
      args.push("--setenv", k, v);
    }
  }

  // Comando alvo.
  args.push(command, ...commandArgs);
  return args;
}

export interface BwrapResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly signal: NodeJS.Signals | null;
}

/**
 * Executa comando dentro de bwrap. Retorna stdout/stderr/exitCode coletados.
 */
export async function runBwrapped(
  config: BwrapConfig,
  command: string,
  commandArgs: ReadonlyArray<string>,
  options: { timeoutMs?: number; bwrapPath?: string } = {},
): Promise<BwrapResult> {
  const bwrapPath = options.bwrapPath ?? config.bwrapPath ?? DEFAULT_BWRAP_PATH;
  if (!isBwrapAvailable(bwrapPath)) {
    throw new Error(
      `bwrap not available at ${bwrapPath}. Install with: apt-get install bubblewrap`,
    );
  }

  const args = buildBwrapArgs(config, command, commandArgs);
  const spawnOptions: SpawnOptions = {
    stdio: ["ignore", "pipe", "pipe"],
  };

  return new Promise<BwrapResult>((resolve) => {
    const child: ChildProcess = spawn(bwrapPath, [...args], spawnOptions);
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = null;
    let killed = false;

    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, options.timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("close", (code, signal) => {
      if (timer !== null) clearTimeout(timer);
      resolve({
        exitCode: code ?? (killed ? 137 : 1),
        stdout,
        stderr,
        signal,
      });
    });
    child.on("error", (err) => {
      if (timer !== null) clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: stderr + (err as Error).message,
        signal: null,
      });
    });
  });
}
