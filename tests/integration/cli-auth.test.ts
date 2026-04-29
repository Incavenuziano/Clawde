import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "@clawde/cli/main";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: unknown): boolean => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout, stderr }))
    .finally(() => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    });
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `sk-ant-oat01-${header}.${body}.sig`;
}

interface EnvSnapshot {
  readonly key: string;
  readonly value: string | undefined;
}

function setEnv(key: string, value: string | undefined): EnvSnapshot {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  return { key, value: prev };
}

function restoreEnv(snap: EnvSnapshot): void {
  if (snap.value === undefined) delete process.env[snap.key];
  else process.env[snap.key] = snap.value;
}

describe("cli auth status", () => {
  let snaps: EnvSnapshot[] = [];
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "clawde-cli-auth-"));
    snaps = [];
  });

  afterEach(() => {
    for (const s of snaps) restoreEnv(s);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("relata 'token: (none)' e exit 4 quando nenhuma source disponível", async () => {
    snaps.push(setEnv("CREDENTIALS_DIRECTORY", undefined));
    snaps.push(setEnv("CLAUDE_CODE_OAUTH_TOKEN", undefined));
    const out = await captureOutput(() => runMain(["auth", "status"]));
    expect(out.exit).toBe(4);
    expect(out.stdout).toContain("(none)");
    expect(out.stdout).toContain("setup-token");
  });

  test("exit 0 e detalhes de expiry quando token JWT válido com >30d", async () => {
    const exp = Math.floor(Date.now() / 1000) + 90 * 86400;
    const tok = makeJwt({ exp });
    snaps.push(setEnv("CREDENTIALS_DIRECTORY", undefined));
    snaps.push(setEnv("CLAUDE_CODE_OAUTH_TOKEN", tok));
    const out = await captureOutput(() => runMain(["auth", "status"]));
    expect(out.exit).toBe(0);
    expect(out.stdout).toContain("source=env");
    expect(out.stdout).toContain("needs_renewal:   no");
  });

  test("exit 1 e needs_renewal=YES quando token vence em <threshold", async () => {
    const exp = Math.floor(Date.now() / 1000) + 5 * 86400;
    const tok = makeJwt({ exp });
    snaps.push(setEnv("CREDENTIALS_DIRECTORY", undefined));
    snaps.push(setEnv("CLAUDE_CODE_OAUTH_TOKEN", tok));
    const out = await captureOutput(() => runMain(["auth", "status"]));
    expect(out.exit).toBe(1);
    expect(out.stdout).toContain("needs_renewal:   YES");
  });

  test("output JSON contém campos esperados", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60 * 86400;
    const tok = makeJwt({ exp });
    snaps.push(setEnv("CREDENTIALS_DIRECTORY", undefined));
    snaps.push(setEnv("CLAUDE_CODE_OAUTH_TOKEN", tok));
    const out = await captureOutput(() => runMain(["auth", "status", "--output", "json"]));
    expect(out.exit).toBe(0);
    const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(parsed.hasToken).toBe(true);
    expect(parsed.source).toBe("env");
    expect(parsed.needsRenewal).toBe(false);
  });

  test("--threshold-days override muda decisão de renovação", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60 * 86400;
    const tok = makeJwt({ exp });
    snaps.push(setEnv("CREDENTIALS_DIRECTORY", undefined));
    snaps.push(setEnv("CLAUDE_CODE_OAUTH_TOKEN", tok));
    const out = await captureOutput(() => runMain(["auth", "status", "--threshold-days", "90"]));
    expect(out.exit).toBe(1);
    expect(out.stdout).toContain("needs_renewal:   YES");
  });

  test("auth check exit 0 mesmo sem token (não bloqueia timer)", async () => {
    snaps.push(setEnv("CREDENTIALS_DIRECTORY", undefined));
    snaps.push(setEnv("CLAUDE_CODE_OAUTH_TOKEN", undefined));
    const out = await captureOutput(() => runMain(["auth", "check"]));
    expect(out.exit).toBe(0);
  });

  test("auth check exit 0 + warn em stderr quando precisa renovar", async () => {
    const exp = Math.floor(Date.now() / 1000) + 5 * 86400;
    const tok = makeJwt({ exp });
    snaps.push(setEnv("CREDENTIALS_DIRECTORY", undefined));
    snaps.push(setEnv("CLAUDE_CODE_OAUTH_TOKEN", tok));
    const out = await captureOutput(() => runMain(["auth", "check"]));
    expect(out.exit).toBe(0);
    expect(out.stderr).toContain("warn:");
    expect(out.stderr).toContain("renew");
  });

  test("respeita --credential-name custom", async () => {
    writeFileSync(join(tmp, "alt-name"), "from-cred-file");
    snaps.push(setEnv("CREDENTIALS_DIRECTORY", tmp));
    snaps.push(setEnv("CLAUDE_CODE_OAUTH_TOKEN", undefined));
    const out = await captureOutput(() =>
      runMain(["auth", "status", "--credential-name", "alt-name"]),
    );
    expect(out.exit).toBe(0);
    expect(out.stdout).toContain("source=systemd-credential");
  });

  test("rejeita action desconhecida com exit 1", async () => {
    const out = await captureOutput(() => runMain(["auth", "wat"]));
    expect(out.exit).toBe(1);
    expect(out.stderr).toContain("unknown auth action");
  });
});
