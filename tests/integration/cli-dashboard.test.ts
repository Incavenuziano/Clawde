import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "@clawde/cli/main";
import { serve } from "bun";

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

const SAMPLE_YAML = `
title: test
databases:
  state:
    queries:
      first_query:
        sql: SELECT 1
      second_query:
        sql: SELECT 2
`;

describe("cli dashboard", () => {
  let tmp: string;
  let metaPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "clawde-dash-"));
    metaPath = join(tmp, "metadata.yaml");
    writeFileSync(metaPath, SAMPLE_YAML);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("reporta unreachable + hint quando datasette não está rodando", async () => {
    const out = await captureOutput(() =>
      runMain([
        "dashboard",
        "--url",
        "http://127.0.0.1:1", // porta inválida garantida
        "--metadata",
        metaPath,
        "--timeout-ms",
        "200",
      ]),
    );
    expect(out.exit).toBe(1);
    expect(out.stdout).toContain("reachable:     no");
    expect(out.stdout).toContain("hint:");
    expect(out.stdout).toContain("first_query");
    expect(out.stdout).toContain("second_query");
  });

  test("reporta reachable + version quando mock datasette responde", async () => {
    const server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/-/versions.json") {
          return new Response(JSON.stringify({ datasette: { version: "0.64.6" } }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const url = `http://${server.hostname}:${server.port}`;
      const out = await captureOutput(() =>
        runMain(["dashboard", "--url", url, "--metadata", metaPath, "--timeout-ms", "1000"]),
      );
      expect(out.exit).toBe(0);
      expect(out.stdout).toContain("reachable:     YES");
      expect(out.stdout).toContain("datasette 0.64.6");
    } finally {
      server.stop(true);
    }
  });

  test("output JSON estruturado", async () => {
    const out = await captureOutput(() =>
      runMain([
        "dashboard",
        "--url",
        "http://127.0.0.1:1",
        "--metadata",
        metaPath,
        "--timeout-ms",
        "200",
        "--output",
        "json",
      ]),
    );
    expect(out.exit).toBe(1);
    const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(parsed.reachable).toBe(false);
    expect(parsed.metadataExists).toBe(true);
    expect(parsed.cannedQueries).toEqual(["first_query", "second_query"]);
    expect(typeof parsed.hint).toBe("string");
  });

  test("metadataExists=false quando path inválido", async () => {
    const out = await captureOutput(() =>
      runMain([
        "dashboard",
        "--url",
        "http://127.0.0.1:1",
        "--metadata",
        "/nonexistent/metadata.yaml",
        "--timeout-ms",
        "200",
        "--output",
        "json",
      ]),
    );
    const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(parsed.metadataExists).toBe(false);
    expect(parsed.cannedQueries).toEqual([]);
  });
});
