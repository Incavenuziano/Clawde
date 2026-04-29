import { describe, expect, test } from "bun:test";
import { runReplica } from "@clawde/cli/commands/replica";
import type { LitestreamRunner } from "@clawde/replica";

function captureOutput(fn: () => Promise<number>): Promise<{
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

const FRESH_OUTPUT = (() => {
  const recent = new Date(Date.now() - 10 * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  return `replica generation index size created
b2 fa7d2c19a8e4 100 12345 ${recent}
`;
})();

const STALE_OUTPUT = `replica generation index size created
b2 olddead 1 100 2025-01-01T00:00:00Z
`;

function makeRunner(stdout: string, exitCode = 0, stderr = ""): LitestreamRunner {
  return async () => ({ stdout, stderr, exitCode });
}

describe("cli replica status", () => {
  test("status text output lista snapshots", async () => {
    const out = await captureOutput(() =>
      runReplica({
        format: "text",
        action: "status",
        dbPath: "/var/clawde/state.db",
        expectedReplicas: ["b2"],
        __runnerOverride: makeRunner(FRESH_OUTPUT),
      }),
    );
    expect(out.exit).toBe(0);
    expect(out.stdout).toContain("b2");
    expect(out.stdout).toContain("gen=fa7d2c19a8e4");
  });

  test("status com snapshots vazios mostra mensagem apropriada", async () => {
    const out = await captureOutput(() =>
      runReplica({
        format: "text",
        action: "status",
        dbPath: "/x.db",
        expectedReplicas: ["b2"],
        __runnerOverride: makeRunner("replica generation index size created\n"),
      }),
    );
    expect(out.exit).toBe(0);
    expect(out.stdout).toContain("(no snapshots");
  });

  test("verify exit 0 quando replica fresco", async () => {
    const out = await captureOutput(() =>
      runReplica({
        format: "text",
        action: "verify",
        dbPath: "/x.db",
        expectedReplicas: ["b2"],
        maxAgeMinutes: 60,
        __runnerOverride: makeRunner(FRESH_OUTPUT),
      }),
    );
    expect(out.exit).toBe(0);
    expect(out.stdout).toContain("overall:    OK");
    expect(out.stdout).toContain("[OK");
  });

  test("verify exit 1 quando replica stale", async () => {
    const out = await captureOutput(() =>
      runReplica({
        format: "text",
        action: "verify",
        dbPath: "/x.db",
        expectedReplicas: ["b2"],
        maxAgeMinutes: 60,
        __runnerOverride: makeRunner(STALE_OUTPUT),
      }),
    );
    expect(out.exit).toBe(1);
    expect(out.stdout).toContain("overall:    FAIL");
    expect(out.stdout).toContain("[STALE");
  });

  test("verify exit 1 quando replica esperado ausente", async () => {
    const out = await captureOutput(() =>
      runReplica({
        format: "text",
        action: "verify",
        dbPath: "/x.db",
        expectedReplicas: ["b2", "local"],
        maxAgeMinutes: 60,
        __runnerOverride: makeRunner(FRESH_OUTPUT),
      }),
    );
    expect(out.exit).toBe(1);
    expect(out.stdout).toContain("[MISSING");
    expect(out.stdout).toContain("local");
  });

  test("output JSON contém estrutura de report", async () => {
    const out = await captureOutput(() =>
      runReplica({
        format: "json",
        action: "verify",
        dbPath: "/x.db",
        expectedReplicas: ["b2"],
        maxAgeMinutes: 60,
        __runnerOverride: makeRunner(FRESH_OUTPUT),
      }),
    );
    expect(out.exit).toBe(0);
    const parsed = JSON.parse(out.stdout) as { ok: boolean; replicas: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.replicas)).toBe(true);
    expect(parsed.replicas.length).toBe(1);
  });

  test("exit 2 quando litestream binary falha", async () => {
    const out = await captureOutput(() =>
      runReplica({
        format: "text",
        action: "status",
        dbPath: "/x.db",
        expectedReplicas: ["b2"],
        __runnerOverride: makeRunner("", 1, "no config"),
      }),
    );
    expect(out.exit).toBe(2);
    expect(out.stderr).toContain("error:");
    expect(out.stderr).toContain("no config");
  });
});
