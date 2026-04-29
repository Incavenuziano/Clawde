import { describe, expect, test } from "bun:test";
import {
  MEMORY_MATCH_TYPES,
  type MemoryMatchType,
  type MemoryObservation,
  type MemorySearchResult,
  type NewMemoryObservation,
  OBSERVATION_KIND_VALUES,
  type ObservationKind,
} from "@clawde/domain/memory";
import type { Workspace } from "@clawde/domain/workspace";

describe("domain/memory OBSERVATION_KIND_VALUES", () => {
  test("includes observation, summary, decision, lesson (ADR 0009)", () => {
    expect(OBSERVATION_KIND_VALUES).toEqual(["observation", "summary", "decision", "lesson"]);
  });
});

describe("domain/memory MEMORY_MATCH_TYPES", () => {
  test("supports fts, embedding, hybrid", () => {
    expect(MEMORY_MATCH_TYPES).toEqual(["fts", "embedding", "hybrid"]);
  });
});

describe("domain/memory types compile", () => {
  test("NewMemoryObservation sample (lesson kind)", () => {
    const obs: NewMemoryObservation = {
      sessionId: null,
      sourceJsonl: null,
      kind: "lesson" satisfies ObservationKind,
      content: "Always check SQL injection in raw concat queries.",
      importance: 0.85,
      consolidatedInto: null,
    };
    expect(obs.kind).toBe("lesson");
    expect(obs.importance).toBeGreaterThan(0.5);
  });

  test("MemorySearchResult shape", () => {
    const result: MemorySearchResult = {
      observation: {
        id: 1,
        sessionId: "550e8400-e29b-51d4-a716-446655440000",
        sourceJsonl: null,
        kind: "observation",
        content: "Read tool returned 100 lines",
        importance: 0.5,
        consolidatedInto: null,
        createdAt: "2026-04-29T10:00:00.000Z",
      } satisfies MemoryObservation,
      score: 0.87,
      matchType: "hybrid" satisfies MemoryMatchType,
    };
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("domain/workspace", () => {
  test("Workspace shape", () => {
    const ws: Workspace = {
      path: "/tmp/clawde-42",
      baseBranch: "main",
      featureBranch: "clawde/123-add-feature",
      taskRunId: 42,
      createdAt: new Date().toISOString(),
    };
    expect(ws.path).toMatch(/^\/tmp\/clawde-\d+$/);
    expect(ws.featureBranch).toMatch(/^clawde\//);
  });
});
