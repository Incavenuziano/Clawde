import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "@clawde/cli/main";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
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
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    });
}

describe("cli war-room", () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-war-room-cli-"));
    prevHome = process.env.HOME;
    process.env.HOME = dir;
  });

  afterEach(() => {
    if (prevHome !== undefined) process.env.HOME = prevHome;
    else process.env.HOME = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  test("open status note plan report close --force", async () => {
    const planPath = join(dir, "PLAN.md");
    writeFileSync(planPath, "- [ ] verify\n\nbun run typecheck\n", "utf-8");

    const open = await captureOutput(() =>
      runMain(["war-room", "open", "--kind", "hardening", "--title", "CLI Test"]),
    );
    expect(open.exit).toBe(0);
    expect(open.stdout).toContain("opened war-room");

    const statusJson = await captureOutput(() =>
      runMain(["war-room", "status", "--output", "json"]),
    );
    expect(statusJson.exit).toBe(0);
    const status = JSON.parse(statusJson.stdout) as { room: { id: string } };
    expect(status.room.id).toMatch(/^WR-/);

    const note = await captureOutput(() => runMain(["war-room", "note", "hello", "timeline"]));
    expect(note.exit).toBe(0);

    const collect = await captureOutput(() =>
      runMain(["war-room", "collect", "--git", "--output", "json"]),
    );
    expect(collect.exit).toBe(0);
    expect(JSON.parse(collect.stdout).results[0].name).toBe("git");

    const plan = await captureOutput(() => runMain(["war-room", "plan", "--from", planPath]));
    expect(plan.exit).toBe(0);

    const report = await captureOutput(() => runMain(["war-room", "report"]));
    expect(report.exit).toBe(0);
    expect(report.stdout).toContain("# War Room");

    const close = await captureOutput(() =>
      runMain(["war-room", "close", "--force", "--reason", "test close"]),
    );
    expect(close.exit).toBe(0);
  });

  test("execute guarded command cria gate sem executar", async () => {
    const planPath = join(dir, "PLAN.md");
    writeFileSync(planPath, "clawde events purge --before 2020-01-01 --confirm\n", "utf-8");
    await captureOutput(() =>
      runMain(["war-room", "open", "--kind", "incident", "--title", "Guard"]),
    );
    await captureOutput(() => runMain(["war-room", "plan", "--from", planPath]));

    const exec = await captureOutput(() =>
      runMain(["war-room", "execute", "--wave", "wave-1", "--confirm"]),
    );
    expect(exec.exit).toBe(2);

    const gates = await captureOutput(() => runMain(["war-room", "gate", "list"]));
    expect(gates.stdout).toContain("GATE-");
  });
});
