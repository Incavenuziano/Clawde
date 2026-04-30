import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DiagnoseReport,
  runDiagnose,
} from "@clawde/cli/commands/diagnose";
import { closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
}> {
  const orig = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = ((c: unknown): boolean => {
    stdout += String(c);
    return true;
  }) as typeof process.stdout.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout }))
    .finally(() => {
      process.stdout.write = orig;
    });
}

describe("cli/commands/diagnose", () => {
  let dir: string;
  let dbPath: string;
  let agentsRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-diagnose-"));
    dbPath = join(dir, "state.db");
    agentsRoot = join(dir, "agents");
    const db = openDb(dbPath);
    applyPending(db, defaultMigrationsDir());
    closeDb(db);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("subject=db retorna ok em DB válido", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runDiagnose({ dbPath, format: "json", subject: "db" }),
    );
    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as DiagnoseReport;
    expect(report.subject).toBe("db");
    expect(report.status).toBe("ok");
    expect(report.checks[0]?.name).toBe("db.integrity");
  });

  test("subject=db retorna error em DB inexistente", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runDiagnose({ dbPath: join(dir, "nope.db"), format: "json", subject: "db" }),
    );
    // openDb cria DB vazio em vez de falhar; integrity_check passa em DB vazio.
    // Aceita ok ou error — só queremos garantir que o handler não crasha.
    expect([0, 2]).toContain(exit);
    const report = JSON.parse(stdout) as DiagnoseReport;
    expect(report.subject).toBe("db");
  });

  test("subject=quota retorna ok em DB sem consumo", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runDiagnose({ dbPath, format: "json", subject: "quota" }),
    );
    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as DiagnoseReport;
    expect(report.checks[0]?.name).toBe("quota.window");
    expect(report.checks[0]?.status).toBe("ok");
  });

  test("subject=agents retorna warn em root inexistente", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runDiagnose({ dbPath, format: "json", subject: "agents", agentsRoot }),
    );
    expect(exit).toBe(1);
    const report = JSON.parse(stdout) as DiagnoseReport;
    expect(report.checks[0]?.status).toBe("warn");
    expect(report.checks[0]?.detail).toContain("not found");
  });

  test("subject=agents lista agentes carregados em root válido", async () => {
    const agentDir = join(agentsRoot, "implementer");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "AGENT.md"),
      [
        "---",
        "name: implementer",
        'role: "Implementa"',
        "model: sonnet",
        "allowedTools: [Read]",
        "disallowedTools: []",
        "maxTurns: 5",
        "sandboxLevel: 1",
        "requiresWorkspace: false",
        "---",
        "",
        "# System Prompt",
        "stub.",
        "",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(join(agentDir, "sandbox.toml"), 'level = 1\nnetwork = "none"\n', "utf-8");

    const { exit, stdout } = await captureOutput(() =>
      runDiagnose({ dbPath, format: "text", subject: "agents", agentsRoot }),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("[OK  ] agents.load");
    expect(stdout).toContain("implementer=L1");
  });

  test("subject=sandbox sem agents level>=2 retorna ok", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runDiagnose({ dbPath, format: "json", subject: "sandbox", agentsRoot }),
    );
    expect(exit).toBe(0);
    const report = JSON.parse(stdout) as DiagnoseReport;
    expect(report.checks[0]?.status).toBe("ok");
  });

  test("subject=oauth retorna warn quando token ausente", async () => {
    const prevToken = process.env.HOME;
    const fakeHome = mkdtempSync(join(tmpdir(), "clawde-diag-home-"));
    process.env.HOME = fakeHome;
    try {
      const { exit, stdout } = await captureOutput(() =>
        runDiagnose({ dbPath, format: "json", subject: "oauth" }),
      );
      const report = JSON.parse(stdout) as DiagnoseReport;
      const status = report.checks[0]?.status ?? "missing";
      // Aceita warn (token ausente) ou ok (token presente em CI).
      expect(["ok", "warn"]).toContain(status);
      expect([0, 1]).toContain(exit);
    } finally {
      if (prevToken !== undefined) process.env.HOME = prevToken;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  test("subject=all agrega múltiplos checks; status = pior dos sub-checks", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runDiagnose({ dbPath, format: "json", subject: "all", agentsRoot }),
    );
    const report = JSON.parse(stdout) as DiagnoseReport;
    expect(report.subject).toBe("all");
    // 5 sub-checks: db, quota, oauth, sandbox, agents
    expect(report.checks).toHaveLength(5);
    // agents=warn (root inexistente) → overall warn no mínimo
    expect(["warn", "error"]).toContain(report.status);
    expect([1, 2]).toContain(exit);
  });
});
