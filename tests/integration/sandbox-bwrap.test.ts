import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyNetnsToConfig,
  buildBwrapArgs,
  defaultLevelForAgent,
  findAgentSandbox,
  generateLoopbackResolvConf,
  isBwrapAvailable,
  loadAgentSandbox,
  loadAllAgents,
  materializeSandbox,
  runBwrapped,
  validateEgressList,
} from "@clawde/sandbox";

describe("sandbox/bwrap buildBwrapArgs", () => {
  test("inclui ro-binds do config + workdir + clearenv", () => {
    const args = buildBwrapArgs(
      {
        readOnlyMounts: [],
        readWritePaths: [{ host: "/tmp/work", sandbox: "/workspace" }],
        network: "none",
        workdir: "/workspace",
        env: { FOO: "bar" },
      },
      "/bin/echo",
      ["hello"],
    );
    expect(args).toContain("--ro-bind");
    expect(args).toContain("/usr");
    expect(args).toContain("--bind");
    expect(args).toContain("/tmp/work");
    expect(args).toContain("/workspace");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--die-with-parent");
    expect(args).toContain("--clearenv");
    expect(args).toContain("--setenv");
    expect(args).toContain("FOO");
    expect(args).toContain("bar");
    expect(args).toContain("--chdir");
    expect(args).toContain("/workspace");
    expect(args[args.length - 2]).toBe("/bin/echo");
    expect(args[args.length - 1]).toBe("hello");
  });

  test("network=host adiciona --share-net", () => {
    const args = buildBwrapArgs(
      {
        readOnlyMounts: [],
        readWritePaths: [],
        network: "host",
      },
      "/bin/true",
      [],
    );
    expect(args).toContain("--share-net");
  });

  test("network=loopback-only NÃO adiciona --share-net (mantém net unshared)", () => {
    const args = buildBwrapArgs(
      {
        readOnlyMounts: [],
        readWritePaths: [],
        network: "loopback-only",
      },
      "/bin/true",
      [],
    );
    expect(args).not.toContain("--share-net");
    expect(args).toContain("--unshare-all");
  });

  test("network=allowlist falha fechada sem backend nftables", () => {
    expect(() =>
      buildBwrapArgs(
        {
          readOnlyMounts: [],
          readWritePaths: [],
          network: "allowlist",
        },
        "/bin/true",
        [],
      ),
    ).toThrow(
      "network='allowlist' requires nftables backend not yet implemented. Use 'host' explicitly.",
    );
  });

  test("network=allowlist com backend disponível adiciona --share-net", () => {
    const args = buildBwrapArgs(
      {
        readOnlyMounts: [],
        readWritePaths: [],
        network: "allowlist",
        allowlistBackendAvailable: true,
      },
      "/bin/true",
      [],
    );
    expect(args).toContain("--share-net");
  });
});

describe("sandbox/bwrap isBwrapAvailable", () => {
  test("retorna true quando bwrap presente", () => {
    expect(isBwrapAvailable()).toBe(true);
  });
  test("retorna false para path inexistente", () => {
    expect(isBwrapAvailable("/nonexistent/bwrap")).toBe(false);
  });
});

describe("sandbox/bwrap runBwrapped (Linux real)", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "clawde-bwrap-"));
  });
  afterEach(() => rmSync(workdir, { recursive: true, force: true }));

  test("executa /bin/echo dentro de bwrap, captura stdout", async () => {
    const result = await runBwrapped(
      {
        readOnlyMounts: [],
        readWritePaths: [{ host: workdir, sandbox: "/workspace" }],
        network: "none",
        workdir: "/workspace",
      },
      "/bin/echo",
      ["clawde sandboxed"],
      { timeoutMs: 5000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("clawde sandboxed");
  });

  test("workspace é writable; paths fora são bloqueados", async () => {
    // Cria arquivo dentro do workspace via bwrap (deve funcionar).
    const result1 = await runBwrapped(
      {
        readOnlyMounts: [],
        readWritePaths: [{ host: workdir, sandbox: "/workspace" }],
        network: "none",
        workdir: "/workspace",
      },
      "/bin/sh",
      ["-c", "echo content > /workspace/test.txt && cat /workspace/test.txt"],
      { timeoutMs: 5000 },
    );
    expect(result1.exitCode).toBe(0);
    expect(result1.stdout).toContain("content");

    // Verifica que arquivo apareceu no host.
    const content = readFileSync(join(workdir, "test.txt"), "utf-8");
    expect(content).toContain("content");

    // Tentativa de escrita em /etc dentro do sandbox: pode escrever no tmpfs
    // interno mas NÃO vaza pro host. /etc do host fica intacto.
    await runBwrapped(
      {
        readOnlyMounts: [],
        readWritePaths: [{ host: workdir, sandbox: "/workspace" }],
        network: "none",
        workdir: "/workspace",
      },
      "/bin/sh",
      ["-c", "echo bad > /etc/clawde-attack.txt 2>&1 || true"],
      { timeoutMs: 5000 },
    );
    // No host, o arquivo NÃO existe (sandbox isolated /etc).
    expect(existsSync("/etc/clawde-attack.txt")).toBe(false);
  });

  test("paths fora dos mounts NÃO são acessíveis (HOME do host bloqueado)", async () => {
    // Cria arquivo no host fora do workdir.
    const secretDir = mkdtempSync(join(tmpdir(), "clawde-secret-"));
    writeFileSync(join(secretDir, "secret.txt"), "TOPSECRET");
    try {
      const result = await runBwrapped(
        {
          readOnlyMounts: [],
          readWritePaths: [{ host: workdir, sandbox: "/workspace" }],
          network: "none",
          workdir: "/workspace",
        },
        "/bin/sh",
        ["-c", `cat ${secretDir}/secret.txt 2>&1; echo exit=$?`],
        { timeoutMs: 5000 },
      );
      // O path nem existe dentro do sandbox.
      expect(result.stdout).toMatch(/(No such file|exit=[1-9])/);
      expect(result.stdout).not.toContain("TOPSECRET");
    } finally {
      rmSync(secretDir, { recursive: true, force: true });
    }
  });

  test("timeout mata processo travado", async () => {
    const result = await runBwrapped(
      {
        readOnlyMounts: [],
        readWritePaths: [{ host: workdir, sandbox: "/workspace" }],
        network: "none",
        workdir: "/workspace",
      },
      "/bin/sleep",
      ["30"],
      { timeoutMs: 200 },
    );
    expect(result.exitCode).not.toBe(0);
    // SIGKILL ou exit code de morte forçada.
    expect([137, 1, null]).toContain(result.signal === "SIGKILL" ? 137 : result.exitCode);
  });

  test("bwrapPath inválido lança erro", async () => {
    await expect(
      runBwrapped(
        {
          readOnlyMounts: [],
          readWritePaths: [{ host: workdir, sandbox: "/workspace" }],
          network: "none",
        },
        "/bin/echo",
        ["x"],
        { bwrapPath: "/nonexistent/bwrap" },
      ),
    ).rejects.toThrow(/bwrap not available/);
  });
});

describe("sandbox/netns", () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "clawde-netns-"));
  });
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  test("generateLoopbackResolvConf cria arquivo em stateDir", () => {
    const path = generateLoopbackResolvConf(stateDir);
    expect(path).toBe(join(stateDir, "sandbox-resolv.conf"));
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("Sem nameservers");
  });

  test("applyNetnsToConfig força loopback-only e adiciona resolv.conf", () => {
    const base = {
      readOnlyMounts: ["/foo"],
      readWritePaths: [{ host: "/x", sandbox: "/x" }],
      network: "host" as const,
    };
    const resolvConfPath = generateLoopbackResolvConf(stateDir);
    const result = applyNetnsToConfig(base, {
      allowedEgress: [],
      resolvConfPath,
    });
    expect(result.network).toBe("loopback-only");
    expect(result.readOnlyMounts).toContain("/foo");
    expect(result.readOnlyMounts).toContain(resolvConfPath);
  });

  test("validateEgressList aceita domains válidos, rejeita inválidos", () => {
    const ok = validateEgressList(["api.anthropic.com", "github.com"]);
    expect(ok.ok).toBe(true);
    expect(ok.invalid).toEqual([]);

    const bad = validateEgressList(["valid.com", "with space", "with/slash", ""]);
    expect(bad.ok).toBe(false);
    expect(bad.invalid).toContain("with space");
    expect(bad.invalid).toContain("with/slash");
    expect(bad.invalid).toContain("");
  });
});

describe("sandbox/agent-config loadAgentSandbox", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-agent-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("sem sandbox.toml: retorna defaults (level=1)", () => {
    const config = loadAgentSandbox(dir);
    expect(config.level).toBe(1);
    expect(config.network).toBe("none");
    expect(config.allowed_egress).toEqual([]);
  });

  test("parse de sandbox.toml válido", () => {
    writeFileSync(
      join(dir, "sandbox.toml"),
      `level = 2
network = "allowlist"
allowed_egress = ["api.anthropic.com"]
allowed_writes = ["./workspace"]
read_only_mounts = ["/usr", "/etc/ssl"]
max_memory_mb = 2048
max_cpu_seconds = 300
`,
    );
    const config = loadAgentSandbox(dir);
    expect(config.level).toBe(2);
    expect(config.network).toBe("allowlist");
    expect(config.allowed_egress).toEqual(["api.anthropic.com"]);
    expect(config.max_memory_mb).toBe(2048);
  });

  test("level inválido (4) lança SandboxConfigError", () => {
    writeFileSync(join(dir, "sandbox.toml"), "level = 4\n");
    expect(() => loadAgentSandbox(dir)).toThrow(/invalid sandbox.toml/);
  });

  test("TOML malformed lança SandboxConfigError", () => {
    writeFileSync(join(dir, "sandbox.toml"), "not [valid] = =");
    expect(() => loadAgentSandbox(dir)).toThrow(/parse TOML/);
  });
});

describe("sandbox/agent-config loadAllAgents", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "clawde-agents-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("agentsRoot inexistente retorna []", () => {
    expect(loadAllAgents("/nonexistent")).toEqual([]);
  });

  test("carrega múltiplos agentes", () => {
    mkdirSync(join(root, "agentA"));
    writeFileSync(join(root, "agentA", "sandbox.toml"), "level = 2\n");
    mkdirSync(join(root, "agentB"));
    // Sem sandbox.toml: pega defaults.

    const agents = loadAllAgents(root);
    expect(agents).toHaveLength(2);
    expect(agents[0]?.name).toBe("agentA");
    expect(agents[0]?.sandbox.level).toBe(2);
    expect(agents[1]?.name).toBe("agentB");
    expect(agents[1]?.sandbox.level).toBe(1);
  });

  test("findAgentSandbox por nome", () => {
    mkdirSync(join(root, "myagent"));
    writeFileSync(join(root, "myagent", "sandbox.toml"), "level = 3\n");

    const config = findAgentSandbox(root, "myagent");
    expect(config.level).toBe(3);
  });
});

describe("sandbox/matrix materializeSandbox", () => {
  let stateDir: string;
  let workspace: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "clawde-state-"));
    workspace = mkdtempSync(join(tmpdir(), "clawde-ws-"));
  });
  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  test("level=1 → runDirect=true, bwrap=null", () => {
    const result = materializeSandbox({
      agent: {
        level: 1,
        network: "none",
        allowed_egress: [],
        allowed_writes: [],
        read_only_mounts: [],
        max_memory_mb: 1024,
        max_cpu_seconds: 600,
      },
      workspacePath: workspace,
      stateDir,
    });
    expect(result.level).toBe(1);
    expect(result.runDirect).toBe(true);
    expect(result.bwrap).toBeNull();
  });

  test("level=2 → bwrap config com workspace mount", () => {
    const result = materializeSandbox({
      agent: {
        level: 2,
        network: "allowlist",
        allowed_egress: ["api.anthropic.com"],
        allowed_writes: ["./workspace"],
        read_only_mounts: ["/etc/ssl"],
        max_memory_mb: 1024,
        max_cpu_seconds: 600,
      },
      workspacePath: workspace,
      stateDir,
    });
    expect(result.level).toBe(2);
    expect(result.runDirect).toBe(false);
    expect(result.bwrap?.network).toBe("allowlist");
    expect(result.bwrap?.readWritePaths).toEqual([{ host: workspace, sandbox: "/workspace" }]);
    expect(result.bwrap?.readOnlyMounts).toContain("/etc/ssl");
    expect(result.bwrap?.workdir).toBe("/workspace");
  });

  test("level=3 → bwrap config + netns + custom resolv.conf", () => {
    const result = materializeSandbox({
      agent: {
        level: 3,
        network: "allowlist",
        allowed_egress: ["api.anthropic.com"],
        allowed_writes: [],
        read_only_mounts: [],
        max_memory_mb: 512,
        max_cpu_seconds: 120,
      },
      workspacePath: workspace,
      stateDir,
    });
    expect(result.level).toBe(3);
    expect(result.bwrap?.network).toBe("loopback-only");
    // Custom resolv.conf foi adicionado aos read-only mounts.
    expect(result.bwrap?.readOnlyMounts.some((p) => p.endsWith("sandbox-resolv.conf"))).toBe(true);
  });

  test("defaultLevelForAgent: telegram-bot=3, implementer=2, default=1", () => {
    expect(defaultLevelForAgent("telegram-bot")).toBe(3);
    expect(defaultLevelForAgent("github-pr-handler")).toBe(3);
    expect(defaultLevelForAgent("implementer")).toBe(2);
    expect(defaultLevelForAgent("debugger")).toBe(2);
    expect(defaultLevelForAgent("default")).toBe(1);
    expect(defaultLevelForAgent("reflector")).toBe(1);
  });
});
