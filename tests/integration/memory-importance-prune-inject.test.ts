import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemoryRepo } from "@clawde/db/repositories/memory";
import {
  DEFAULT_IMPORTANCE_CONFIG,
  DEFAULT_MEMORY_AWARE_CONFIG,
  DEFAULT_PRUNE_OPTIONS,
  buildMemoryContext,
  prune,
  recalcImportance,
  scoreObservation,
} from "@clawde/memory";
import { type TestDb, makeTestDb } from "../helpers/db.ts";

interface Setup {
  readonly testDb: TestDb;
  readonly repo: MemoryRepo;
}

function makeSetup(): Setup {
  const testDb = makeTestDb();
  const repo = new MemoryRepo(testDb.db);
  return { testDb, repo };
}

describe("memory/importance scoreObservation", () => {
  test("observation nova (0 dias) com 0 refs → ~baseScore", () => {
    const score = scoreObservation({
      kind: "observation",
      createdAt: new Date().toISOString(),
      refCount: 0,
    });
    expect(score).toBeCloseTo(DEFAULT_IMPORTANCE_CONFIG.baseScore, 2);
  });

  test("decay: 30 dias reduz score", () => {
    const now = new Date("2026-04-29T12:00:00Z");
    const old = new Date("2026-03-30T12:00:00Z").toISOString();
    const recent = new Date("2026-04-29T12:00:00Z").toISOString();
    const oldScore = scoreObservation({
      kind: "observation",
      createdAt: old,
      refCount: 0,
      now,
    });
    const recentScore = scoreObservation({
      kind: "observation",
      createdAt: recent,
      refCount: 0,
      now,
    });
    expect(oldScore).toBeLessThan(recentScore);
  });

  test("consolidação boost: refCount eleva score", () => {
    const now = new Date();
    const a = scoreObservation({
      kind: "observation",
      createdAt: now.toISOString(),
      refCount: 0,
      now,
    });
    const b = scoreObservation({
      kind: "observation",
      createdAt: now.toISOString(),
      refCount: 3,
      now,
    });
    expect(b).toBeGreaterThan(a);
  });

  test("lesson floor: lesson antiga ainda fica >= lessonFloor", () => {
    const score = scoreObservation({
      kind: "lesson",
      createdAt: "2020-01-01T00:00:00Z",
      refCount: 0,
    });
    expect(score).toBeGreaterThanOrEqual(DEFAULT_IMPORTANCE_CONFIG.lessonFloor);
  });

  test("clamp em 1.0 mesmo com muitas refs", () => {
    const score = scoreObservation({
      kind: "observation",
      createdAt: new Date().toISOString(),
      refCount: 100,
    });
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("memory/importance recalcImportance", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.testDb.cleanup());

  test("aplica scores recalculados em todas as rows", () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "test 1",
      importance: 0.5,
      consolidatedInto: null,
    });
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "test 2",
      importance: 0.3,
      consolidatedInto: null,
    });

    const result = recalcImportance(setup.testDb.db, setup.repo);
    // lesson (0.3 → ≥0.7 floor) atualiza; observation já em ~0.5 pode skippar.
    expect(result.updated).toBeGreaterThanOrEqual(1);
  });
});

describe("memory/inject buildMemoryContext", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.testDb.cleanup());

  function insertObs(content: string, importance = 0.5, kind: "observation" | "lesson" = "observation") {
    return setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind,
      content,
      importance,
      consolidatedInto: null,
    }).id;
  }

  test("config disabled: retorna injected=false sem snippet", async () => {
    insertObs("any");
    const result = await buildMemoryContext(setup.repo, "any", {
      ...DEFAULT_MEMORY_AWARE_CONFIG,
      enabled: false,
    });
    expect(result.injected).toBe(false);
    expect(result.snippet).toBe("");
  });

  test("sem matches: injected=false", async () => {
    insertObs("conteúdo aleatório");
    const result = await buildMemoryContext(setup.repo, "xyz123abc");
    expect(result.injected).toBe(false);
  });

  test("com matches: snippet contém prior_context wrapper", async () => {
    insertObs("padrão de retry funcionou", 0.8);
    insertObs("memória persistente é importante", 0.9);
    const result = await buildMemoryContext(setup.repo, "padrão*");
    expect(result.injected).toBe(true);
    expect(result.snippet).toContain("<prior_context");
    expect(result.snippet).toContain("</prior_context>");
    expect(result.snippet).toContain("source=\"clawde-memory\"");
    expect(result.observations.length).toBeGreaterThan(0);
  });

  test("filtro minImportance: observations baixas excluídas", async () => {
    insertObs("retry baixa importância", 0.1);
    insertObs("retry alta importância", 0.9);
    const result = await buildMemoryContext(setup.repo, "retry*", {
      ...DEFAULT_MEMORY_AWARE_CONFIG,
      minImportance: 0.5,
    });
    expect(result.observations.length).toBe(1);
    expect(result.observations[0]?.content).toContain("alta");
  });

  test("maxInjectChars trunca", async () => {
    // 20 obs curtas (~80 chars cada) com "retry"; cap de 600 → ~5 cabem.
    for (let i = 0; i < 20; i++) {
      insertObs(`retry pattern observation ${i}`, 0.7);
    }
    const result = await buildMemoryContext(setup.repo, "retry*", {
      ...DEFAULT_MEMORY_AWARE_CONFIG,
      topK: 20,
      maxInjectChars: 600,
    });
    expect(result.injected).toBe(true);
    expect(result.snippet.length).toBeLessThan(900); // 600 + wrapper
    expect(result.truncated).toBeGreaterThan(0);
  });
});

describe("memory/prune", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.testDb.cleanup());

  test("dry-run conta sem deletar", () => {
    // Insert observation antiga + low importance (matemática manual depois).
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "old low",
      importance: 0.1,
      consolidatedInto: null,
    });
    // Forçar created_at antigo via UPDATE direto (testes só).
    setup.testDb.db.exec("UPDATE memory_observations SET created_at = '2020-01-01 00:00:00'");

    const dryResult = prune(setup.repo, {
      ...DEFAULT_PRUNE_OPTIONS,
      dryRun: true,
    });
    expect(dryResult.deleted).toBe(1);
    expect(dryResult.dryRun).toBe(true);

    // Real ainda existe.
    expect(setup.repo.listAllWithEmbeddings()).toHaveLength(1);
  });

  test("real prune deleta + lessons preservadas", () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "old low",
      importance: 0.1,
      consolidatedInto: null,
    });
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson",
      content: "old lesson preserved",
      importance: 0.05,
      consolidatedInto: null,
    });
    setup.testDb.db.exec("UPDATE memory_observations SET created_at = '2020-01-01 00:00:00'");

    const result = prune(setup.repo, DEFAULT_PRUNE_OPTIONS);
    expect(result.deleted).toBe(1);
    expect(result.dryRun).toBe(false);

    // Lesson sobrevive.
    const remaining = setup.repo.listAllWithEmbeddings();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.obs.kind).toBe("lesson");
  });

  test("observations recentes não são deletadas", () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "new low",
      importance: 0.1,
      consolidatedInto: null,
    });
    const result = prune(setup.repo, DEFAULT_PRUNE_OPTIONS);
    expect(result.deleted).toBe(0);
  });

  test("observations com importance >= cutoff não são deletadas", () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "old high importance",
      importance: 0.5,
      consolidatedInto: null,
    });
    setup.testDb.db.exec("UPDATE memory_observations SET created_at = '2020-01-01 00:00:00'");
    const result = prune(setup.repo, DEFAULT_PRUNE_OPTIONS);
    expect(result.deleted).toBe(0);
  });
});
