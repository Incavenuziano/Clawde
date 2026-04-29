import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryRepo } from "@clawde/db/repositories/memory";
import { runIndexer } from "@clawde/memory";
import { type TestDb, makeTestDb } from "../helpers/db.ts";

interface Setup {
  readonly testDb: TestDb;
  readonly repo: MemoryRepo;
  readonly jsonlRoot: string;
  readonly cleanup: () => void;
}

function makeSetup(): Setup {
  const testDb = makeTestDb();
  const repo = new MemoryRepo(testDb.db);
  const jsonlRoot = mkdtempSync(join(tmpdir(), "clawde-jsonl-"));
  return {
    testDb,
    repo,
    jsonlRoot,
    cleanup: () => {
      testDb.cleanup();
      rmSync(jsonlRoot, { recursive: true, force: true });
    },
  };
}

function writeJsonl(
  root: string,
  project: string,
  file: string,
  lines: ReadonlyArray<string>,
): string {
  const dir = join(root, project);
  mkdirSync(dir, { recursive: true });
  const full = join(dir, file);
  writeFileSync(full, `${lines.join("\n")}\n`);
  return full;
}

describe("memory/jsonl-indexer runIndexer", () => {
  let setup: Setup;

  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.cleanup());

  test("indexa arquivo válido de 3 linhas", () => {
    writeJsonl(setup.jsonlRoot, "abc-hash", "session1.jsonl", [
      JSON.stringify({ role: "user", content: "Olá Claude", sessionId: "s1" }),
      JSON.stringify({ role: "assistant", content: "Olá!", sessionId: "s1" }),
      JSON.stringify({
        role: "assistant",
        content: "Aqui vai uma análise detalhada do seu pedido. ".repeat(10),
        sessionId: "s1",
      }),
    ]);

    const result = runIndexer(setup.repo, { jsonlRoot: setup.jsonlRoot });

    expect(result.filesScanned).toBe(1);
    expect(result.linesParsed).toBe(3);
    expect(result.observationsInserted).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  test("kind heuristic: assistant >200 chars vira summary", () => {
    writeJsonl(setup.jsonlRoot, "h", "s.jsonl", [
      JSON.stringify({
        role: "assistant",
        content: "x".repeat(300),
        sessionId: "s1",
      }),
    ]);
    runIndexer(setup.repo, { jsonlRoot: setup.jsonlRoot });
    const summaries = setup.repo.listByKind("summary");
    expect(summaries).toHaveLength(1);
  });

  test("rerun é idempotente (dedup por source_jsonl)", () => {
    writeJsonl(setup.jsonlRoot, "h", "s.jsonl", [
      JSON.stringify({ role: "user", content: "test", sessionId: "s1" }),
      JSON.stringify({ role: "user", content: "test 2", sessionId: "s1" }),
    ]);

    const first = runIndexer(setup.repo, { jsonlRoot: setup.jsonlRoot });
    expect(first.observationsInserted).toBe(2);

    const second = runIndexer(setup.repo, { jsonlRoot: setup.jsonlRoot });
    expect(second.observationsInserted).toBe(0);
    expect(second.linesParsed).toBe(2);
  });

  test("linha truncada (JSON inválido) é pulada sem propagar erro", () => {
    writeJsonl(setup.jsonlRoot, "h", "s.jsonl", [
      JSON.stringify({ role: "user", content: "valid", sessionId: "s1" }),
      '{ "role": "assistant", "content": "broken',
      JSON.stringify({ role: "user", content: "after broken", sessionId: "s1" }),
    ]);
    const result = runIndexer(setup.repo, { jsonlRoot: setup.jsonlRoot });
    expect(result.observationsInserted).toBe(2);
  });

  test("array de blocks com type=text", () => {
    writeJsonl(setup.jsonlRoot, "h", "s.jsonl", [
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "text", text: "primeiro" },
          { type: "tool_use", name: "Bash", input: {}, id: "tu_1" },
          { type: "text", text: "segundo" },
        ],
        sessionId: "s1",
      }),
    ]);
    runIndexer(setup.repo, { jsonlRoot: setup.jsonlRoot });
    const obs = setup.repo.searchFTS("primeiro");
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0]?.observation.content).toContain("primeiro");
    expect(obs[0]?.observation.content).toContain("segundo");
  });

  test("recursão em subdirs (~/.claude/projects/<hash>/file.jsonl)", () => {
    writeJsonl(setup.jsonlRoot, "proj-a/sub", "s1.jsonl", [
      JSON.stringify({ role: "user", content: "a", sessionId: "s1" }),
    ]);
    writeJsonl(setup.jsonlRoot, "proj-b", "s2.jsonl", [
      JSON.stringify({ role: "user", content: "b", sessionId: "s2" }),
    ]);

    const result = runIndexer(setup.repo, { jsonlRoot: setup.jsonlRoot });
    expect(result.filesScanned).toBe(2);
    expect(result.observationsInserted).toBe(2);
  });

  test("file too large pulado com error registrado", () => {
    writeJsonl(setup.jsonlRoot, "h", "s.jsonl", [
      JSON.stringify({ role: "user", content: "x".repeat(100), sessionId: "s1" }),
    ]);
    const result = runIndexer(setup.repo, {
      jsonlRoot: setup.jsonlRoot,
      maxFileBytes: 50,
    });
    expect(result.observationsInserted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain("file too large");
  });

  test("jsonlRoot inexistente retorna 0 files", () => {
    const result = runIndexer(setup.repo, {
      jsonlRoot: "/nonexistent/path",
    });
    expect(result.filesScanned).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test("maxPerFile limita observations por arquivo", () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ role: "user", content: `msg${i}`, sessionId: "s1" }));
    }
    writeJsonl(setup.jsonlRoot, "h", "s.jsonl", lines);

    const result = runIndexer(setup.repo, {
      jsonlRoot: setup.jsonlRoot,
      maxPerFile: 3,
    });
    expect(result.observationsInserted).toBe(3);
  });
});
