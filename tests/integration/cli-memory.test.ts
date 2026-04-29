import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMain } from "@clawde/cli/main";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { MemoryRepo } from "@clawde/db/repositories/memory";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((c: unknown): boolean => {
    stdout += String(c);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown): boolean => {
    stderr += String(c);
    return true;
  }) as typeof process.stderr.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout, stderr }))
    .finally(() => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    });
}

interface Setup {
  readonly db: ClawdeDatabase;
  readonly dbPath: string;
  readonly repo: MemoryRepo;
  readonly cleanup: () => void;
}

function makeSetup(): Setup {
  const dir = mkdtempSync(join(tmpdir(), "clawde-cli-mem-"));
  const dbPath = join(dir, "state.db");
  const db = openDb(dbPath);
  applyPending(db, defaultMigrationsDir());
  const repo = new MemoryRepo(db);
  return {
    db,
    dbPath,
    repo,
    cleanup: () => {
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("cli memory", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.cleanup());

  test("sem action: exit 1 com lista de actions", async () => {
    const { exit, stderr } = await captureOutput(() => runMain(["memory", "--db", setup.dbPath]));
    expect(exit).toBe(1);
    expect(stderr).toContain("memory action required");
  });

  test("memory stats: counts e distribuição", async () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "test",
      importance: 0.5,
      consolidatedInto: null,
    });
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "lesson",
      importance: 0.9,
      consolidatedInto: null,
    });

    const { exit, stdout } = await captureOutput(() =>
      runMain(["memory", "stats", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("counts by kind:");
    expect(stdout).toContain("observation");
    expect(stdout).toContain("lesson");
    expect(stdout).toContain("importance distribution:");
  });

  test("memory search retorna matches", async () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "padrão de retry funcionou após 3 tentativas",
      importance: 0.7,
      consolidatedInto: null,
    });
    const { exit, stdout } = await captureOutput(() =>
      runMain(["memory", "search", "retry*", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("retry");
    expect(stdout).toContain("[observation");
  });

  test("memory search sem query: exit 1", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runMain(["memory", "search", "--db", setup.dbPath]),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("query required");
  });

  test("memory show <id>: detalhes formatados", async () => {
    const inserted = setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "lesson detalhada",
      importance: 0.85,
      consolidatedInto: null,
    });
    const { exit, stdout } = await captureOutput(() =>
      runMain(["memory", "show", String(inserted.id), "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain(`id:               ${inserted.id}`);
    expect(stdout).toContain("kind:             lesson");
    expect(stdout).toContain("importance:       0.850");
  });

  test("memory show id inexistente: exit 2", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runMain(["memory", "show", "9999", "--db", setup.dbPath]),
    );
    expect(exit).toBe(2);
    expect(stderr).toContain("not found");
  });

  test("memory prune --dry-run: relata sem deletar", async () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "old low",
      importance: 0.1,
      consolidatedInto: null,
    });
    setup.db.exec("UPDATE memory_observations SET created_at = '2020-01-01 00:00:00'");
    const { exit, stdout } = await captureOutput(() =>
      runMain(["memory", "prune", "--dry-run", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("would delete 1");
  });

  test("memory recalc atualiza scores", async () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "lesson",
      importance: 0.3,
      consolidatedInto: null,
    });
    const { exit, stdout } = await captureOutput(() =>
      runMain(["memory", "recalc", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("recalc:");
  });

  test("memory inject: gera prior_context snippet", async () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "padrão de retry sempre funciona",
      importance: 0.9,
      consolidatedInto: null,
    });
    const { exit, stdout } = await captureOutput(() =>
      runMain(["memory", "inject", "retry*", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("<prior_context");
    expect(stdout).toContain("retry");
  });

  test("memory action desconhecida: exit 1", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runMain(["memory", "frobnicate", "--db", setup.dbPath]),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("unknown memory action");
  });

  test("memory --output json: parseável", async () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "test json",
      importance: 0.5,
      consolidatedInto: null,
    });
    const { exit, stdout } = await captureOutput(() =>
      runMain(["memory", "stats", "--output", "json", "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.byKind).toBeDefined();
    expect(parsed.importance).toBeDefined();
  });
});
