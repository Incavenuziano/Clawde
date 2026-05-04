import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildBwrapArgs } from "./bwrap.ts";

const CLAUDE_AGENT_SDK_LINUX_X64 =
  "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude";

/**
 * Resolve the native claude binary bundled with the SDK, falling back to the
 * system claude if the SDK binary is not present.
 */
export function resolveClaudeNativeBinary(projectRoot = process.cwd()): string {
  const candidate = join(projectRoot, CLAUDE_AGENT_SDK_LINUX_X64);
  if (existsSync(candidate)) return candidate;
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
  projectRoot?: string,
): SandboxedWrapper {
  const claudeBinary = resolveClaudeNativeBinary(projectRoot);
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
  return "'" + s.replace(/'/g, "'\\''") + "'";
}