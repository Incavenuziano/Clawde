import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MemoryRepo } from "@clawde/db/repositories/memory";
import {
  DeterministicHashProvider,
  EMBEDDING_DIM,
  NoopEmbeddingProvider,
  cosineSim,
  searchHybrid,
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

describe("memory/embeddings providers", () => {
  test("NoopEmbeddingProvider retorna vetor zero de tamanho 384", async () => {
    const p = new NoopEmbeddingProvider();
    const v = await p.embed("hello");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(EMBEDDING_DIM);
    expect(Array.from(v).every((x) => x === 0)).toBe(true);
  });

  test("DeterministicHashProvider retorna vetor com norm ≈ 1 (L2-normalized)", async () => {
    const p = new DeterministicHashProvider();
    const v = await p.embed("hello world");
    expect(v.length).toBe(EMBEDDING_DIM);
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += (v[i] ?? 0) ** 2;
    const norm = Math.sqrt(sum);
    expect(norm).toBeGreaterThan(0.99);
    expect(norm).toBeLessThan(1.01);
  });

  test("DeterministicHashProvider é determinístico", async () => {
    const p = new DeterministicHashProvider();
    const a = await p.embed("hello");
    const b = await p.embed("hello");
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(a[i]).toBe(b[i] ?? 0);
    }
  });

  test("DeterministicHashProvider produz vetores diferentes pra strings diferentes", async () => {
    const p = new DeterministicHashProvider();
    const a = await p.embed("hello");
    const b = await p.embed("world");
    let differs = false;
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });
});

describe("memory/cosineSim", () => {
  test("cosine de vetor com ele mesmo (normalized) ≈ 1", async () => {
    const p = new DeterministicHashProvider();
    const v = await p.embed("test");
    expect(cosineSim(v, v)).toBeGreaterThan(0.99);
  });

  test("vetores diferentes têm cosine < 1", async () => {
    const p = new DeterministicHashProvider();
    const a = await p.embed("apple");
    const b = await p.embed("zebra");
    expect(cosineSim(a, b)).toBeLessThan(0.99);
  });

  test("comprimentos diferentes retornam 0", () => {
    expect(cosineSim(new Float32Array(2), new Float32Array(3))).toBe(0);
  });
});

describe("memory/search searchHybrid", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.testDb.cleanup());

  function insertObs(
    content: string,
    importance = 0.5,
    kind: "observation" | "lesson" = "observation",
  ): number {
    return setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind,
      content,
      importance,
      consolidatedInto: null,
    }).id;
  }

  test("FTS5 only (sem embedding provider): retorna matches por keyword", async () => {
    insertObs("padrão de retry funcionou após 3 tentativas");
    insertObs("sandbox bloqueou acesso ao /etc/passwd");
    insertObs("memória persistente é importante");

    const results = await searchHybrid(setup.repo, { query: "retry*", limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.observation.content).toContain("retry");
    expect(results[0]?.matchType).toBe("fts");
  });

  test("importance boost: lesson com importance alta ranqueia primeiro", async () => {
    const idA = insertObs("retry padrão repetido", 0.2);
    const idB = insertObs("retry padrão importante", 0.95, "lesson");

    const results = await searchHybrid(setup.repo, {
      query: "retry*",
      limit: 5,
      importanceBoost: 2.0,
    });
    expect(results[0]?.observation.id).toBe(idB);
    expect(results[1]?.observation.id).toBe(idA);
  });

  test("hybrid com DeterministicHashProvider: matchType pode ser hybrid", async () => {
    const provider = new DeterministicHashProvider();
    const id = insertObs("hello world clawde");
    const v = await provider.embed("hello world clawde");
    setup.repo.updateEmbedding(id, v);

    const results = await searchHybrid(setup.repo, { query: "hello*", limit: 5 }, provider);
    expect(results.length).toBeGreaterThan(0);
    // Match em FTS5 + cosine → hybrid.
    expect(results[0]?.matchType).toBe("hybrid");
  });

  test("query sem matches retorna []", async () => {
    insertObs("conteúdo aleatório");
    const results = await searchHybrid(setup.repo, { query: "xyz123abc", limit: 5 });
    expect(results).toHaveLength(0);
  });

  test("limit respeita cap", async () => {
    for (let i = 0; i < 10; i++) {
      insertObs(`memory teste ${i}`);
    }
    const results = await searchHybrid(setup.repo, { query: "memory*", limit: 3 });
    expect(results).toHaveLength(3);
  });
});

describe("memory updateEmbedding + listAllWithEmbeddings", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });
  afterEach(() => setup.testDb.cleanup());

  test("updateEmbedding persiste BLOB e listAllWithEmbeddings recupera", async () => {
    const id = setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "test embedding",
      importance: 0.5,
      consolidatedInto: null,
    }).id;

    const provider = new DeterministicHashProvider();
    const original = await provider.embed("test embedding");
    setup.repo.updateEmbedding(id, original);

    const all = setup.repo.listAllWithEmbeddings();
    const retrieved = all.find((r) => r.obs.id === id);
    expect(retrieved?.embedding).not.toBeNull();
    expect(retrieved?.embedding?.length).toBe(EMBEDDING_DIM);
    // Roundtrip: vetor recuperado bate (within float tolerance).
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      expect(retrieved?.embedding?.[i]).toBeCloseTo(original[i] ?? 0, 5);
    }
  });

  test("observations sem updateEmbedding têm embedding=null", () => {
    setup.repo.insertObservation({
      sessionId: null,
      sourceJsonl: null,
      kind: "observation",
      content: "no embedding",
      importance: 0.5,
      consolidatedInto: null,
    });
    const all = setup.repo.listAllWithEmbeddings();
    expect(all[0]?.embedding).toBeNull();
  });
});
