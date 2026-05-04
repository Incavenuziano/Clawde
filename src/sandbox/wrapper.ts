import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildBwrapArgs } from "./bwrap.ts";

const CLAUDE_AGENT_SDK_LINUX_X64 = "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude";
const CLAUDE_LOCAL_SYMLINK = ".clawde/bin/claude";

/**
 * Resolve the claude binary path for worker sandbox wrapper.
 *
 * Resolution order:
 *  1) SDK bundled binary in project node_modules
 *  2) Clawde local symlink (~/.clawde/bin/claude) created by setup-linux.sh
 *  3) System fallback (/usr/local/bin/claude)
 */
export function resolveClaudeNativeBinary(
  projectRoot = process.cwd(),
  homePath = homedir(),
): string {
  const candidate = join(projectRoot, CLAUDE_AGENT_SDK_LINUX_X64);
  if (existsSync(candidate)) return candidate;
  const localSymlink = join(homePath, CLAUDE_LOCAL_SYMLINK);
  if (existsSync(localSymlink)) return localSymlink;
  return "/usr/local/bin/claude";
}

export interface SandboxedWrapper {
  readonly wrapperPath: string;
  cleanup(): void;
}

/**
 * Creates a temp directory containing a `claude` wrapper script that runs the
 * real claude binary inside bwrap with filesystem isolation.
 *
 * Network is intentionally kept as "host" — the claude binary needs egress to
 * api.anthropic.com. Full network isolation (loopback-only) is deferred to
 * Fase 6C, which requires a local API proxy (nftables backend, issue #49).
 *
 * Returns the wrapper path and a cleanup function.
 */
export function makeSandboxedClaudeWrapper(
  agentName: string,
  agentReadOnlyMounts: ReadonlyArray<string>,
  env: Record<string, string | undefined>,
  claudeBinaryOverride?: string,
  projectRoot?: string,
): SandboxedWrapper {
  const claudeBinary = claudeBinaryOverride ?? resolveClaudeNativeBinary(projectRoot);
  const home = homedir();
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");

  const bwrapArgs = buildBwrapArgs(
    {
      bwrapPath: "/usr/bin/bwrap",
      readOnlyMounts: [
        ...agentReadOnlyMounts,
        ...(existsSync(claudeConfigDir) ? [claudeConfigDir] : []),
        ...(existsSync(join(home, ".claude.json")) ? [join(home, ".claude.json")] : []),
      ],
      readWritePaths: [{ host: tmpdir(), sandbox: tmpdir() }],
      // host network: API egress required (see function doc above)
      network: "host",
      workdir: tmpdir(),
      env: {
        HOME: home,
        TMPDIR: tmpdir(),
        PATH: "/usr/bin:/usr/local/bin:/bin",
        CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
        ...(env.CLAUDE_CODE_OAUTH_TOKEN
          ? { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN }
          : {}),
        ...(env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR } : {}),
        ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
      },
    },
    claudeBinary,
    [],
  );

  // All args except the last item (the claude binary path, which we append with "$@")
  const configArgs = bwrapArgs.slice(0, -1);
  const quotedArgs = configArgs.map(shellQuote).join(" ");
  const script = `#!/bin/sh\nexec /usr/bin/bwrap ${quotedArgs} ${shellQuote(claudeBinary)} "$@"\n`;

  const tmpDir = mkdtempSync(join(tmpdir(), `clawde-wrap-${agentName}-`));
  const wrapperPath = join(tmpDir, "claude");
  writeFileSync(wrapperPath, script, { encoding: "utf-8" });
  chmodSync(wrapperPath, 0o755);

  return { wrapperPath, cleanup: () => rmSync(tmpDir, { recursive: true, force: true }) };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
