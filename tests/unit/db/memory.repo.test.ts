import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemoryRepo } from "@clawde/db/repositories/memory";
import { type TestDb, makeTestDb } from "../../helpers/db.ts";

describe("repositories/memory", () => {
  let testDb: TestDb;
  let repo: MemoryRepo;

  beforeEach(() => {
    testDb = makeTestDb();
    repo = new MemoryRepo(testDb.db);
  });
  afterEach(() => testDb.cleanup());

  test("insertObservation + findById roundtrip", () => {
    const obs = repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "Read tool returned 100 lines of code.",
      importance: 0.5,
      consolidatedInto: null,
    });
    expect(obs.id).toBeGreaterThan(0);
    expect(obs.kind).toBe("observation");
    expect(obs.importance).toBe(0.5);

    const found = repo.findById(obs.id);
    expect(found).toEqual(obs);
  });

  test("insertObservation com kind='lesson' aceito (ADR 0009)", () => {
    const lesson = repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "Always check SQL injection in raw concat queries.",
      importance: 0.9,
      consolidatedInto: null,
    });
    expect(lesson.kind).toBe("lesson");
    expect(lesson.importance).toBe(0.9);
  });

  test("CHECK constraint: importance fora de [0,1] rejeitado", () => {
    expect(() =>
      testDb.db.exec(
        `INSERT INTO memory_observations (kind, content, importance) VALUES ('observation', 'x', 1.5)`,
      ),
    ).toThrow(/CHECK/);
  });

  test("searchFTS trigram funciona em PT-BR", () => {
    repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "Memória persistente é importante para o aprendizado.",
      importance: 0.5,
      consolidatedInto: null,
    });
    repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "Sandbox impede execução fora do worktree.",
      importance: 0.5,
      consolidatedInto: null,
    });

    const results = repo.searchFTS("memó*");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.matchType).toBe("fts");
    expect(results[0]?.observation.content).toContain("Memória");
  });

  test("searchFTS trigram funciona em EN", () => {
    repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "Persistent memory enables learning across sessions.",
      importance: 0.5,
      consolidatedInto: null,
    });
    const results = repo.searchFTS("memo*");
    expect(results.length).toBeGreaterThan(0);
  });

  test("searchFTS query sem matches retorna []", () => {
    repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "completely unrelated text",
      importance: 0.5,
      consolidatedInto: null,
    });
    const results = repo.searchFTS("xyz123abc");
    expect(results).toEqual([]);
  });

  test("listByKind ordena por importance desc + created_at desc", () => {
    repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "low-importance lesson",
      importance: 0.3,
      consolidatedInto: null,
    });
    repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "high-importance lesson",
      importance: 0.95,
      consolidatedInto: null,
    });
    repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "not a lesson",
      importance: 1.0,
      consolidatedInto: null,
    });

    const lessons = repo.listByKind("lesson");
    expect(lessons).toHaveLength(2);
    expect(lessons[0]?.content).toBe("high-importance lesson");
    expect(lessons[1]?.content).toBe("low-importance lesson");
  });

  test("FTS5 sync trigger: INSERT em memory_observations atualiza memory_fts", () => {
    const obs = repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "test FTS sync",
      importance: 0.5,
      consolidatedInto: null,
    });
    const ftsRow = testDb.db
      .query<{ rowid: number; content: string }, [string]>(
        "SELECT rowid, content FROM memory_fts WHERE memory_fts MATCH ?",
      )
      .get("test FTS sync");
    expect(ftsRow?.rowid).toBe(obs.id);
  });
});
