import { describe, expect, test } from "bun:test";
import { type LitestreamSnapshot, verifyReplicas } from "@clawde/replica";

const NOW = new Date("2026-04-29T12:00:00Z");

function snap(opts: Partial<LitestreamSnapshot> & { createdAt: string }): LitestreamSnapshot {
  return {
    replica: opts.replica ?? "b2",
    generation: opts.generation ?? "g1",
    index: opts.index ?? 1,
    size: opts.size ?? 100,
    createdAt: opts.createdAt,
  };
}

describe("replica/verify verifyReplicas", () => {
  test("ok=true quando todos os replicas têm snapshot fresco", () => {
    const r = verifyReplicas({
      snapshots: [
        snap({ replica: "b2", createdAt: "2026-04-29T11:30:00Z" }),
        snap({ replica: "local", createdAt: "2026-04-29T11:55:00Z" }),
      ],
      expectedReplicas: ["b2", "local"],
      maxAgeMinutes: 60,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.replicas.length).toBe(2);
    expect(r.replicas.every((x) => x.fresh)).toBe(true);
  });

  test("ok=false quando replica esperado não tem snapshot", () => {
    const r = verifyReplicas({
      snapshots: [snap({ replica: "b2", createdAt: "2026-04-29T11:30:00Z" })],
      expectedReplicas: ["b2", "local"],
      maxAgeMinutes: 60,
      now: NOW,
    });
    expect(r.ok).toBe(false);
    const local = r.replicas.find((x) => x.replica === "local");
    expect(local?.hasSnapshot).toBe(false);
    expect(local?.fresh).toBe(false);
    expect(local?.snapshotCount).toBe(0);
  });

  test("fresh=false quando snapshot mais recente é antigo", () => {
    const r = verifyReplicas({
      snapshots: [snap({ replica: "b2", createdAt: "2026-04-29T08:00:00Z" })],
      expectedReplicas: ["b2"],
      maxAgeMinutes: 60,
      now: NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.replicas[0]?.fresh).toBe(false);
    expect(r.replicas[0]?.ageMinutes).toBe(240); // 4h
  });

  test("seleciona snapshot mais recente entre múltiplos da mesma replica", () => {
    const r = verifyReplicas({
      snapshots: [
        snap({ replica: "b2", index: 1, createdAt: "2026-04-29T08:00:00Z" }),
        snap({ replica: "b2", index: 2, createdAt: "2026-04-29T11:30:00Z" }),
        snap({ replica: "b2", index: 3, createdAt: "2026-04-29T10:00:00Z" }),
      ],
      expectedReplicas: ["b2"],
      maxAgeMinutes: 60,
      now: NOW,
    });
    expect(r.replicas[0]?.latestCreatedAt).toBe("2026-04-29T11:30:00Z");
    expect(r.replicas[0]?.snapshotCount).toBe(3);
    expect(r.replicas[0]?.fresh).toBe(true);
  });

  test("ignora snapshots de replicas não esperados", () => {
    const r = verifyReplicas({
      snapshots: [
        snap({ replica: "b2", createdAt: "2026-04-29T11:30:00Z" }),
        snap({ replica: "rogue", createdAt: "2026-04-29T11:55:00Z" }),
      ],
      expectedReplicas: ["b2"],
      maxAgeMinutes: 60,
      now: NOW,
    });
    expect(r.replicas.length).toBe(1);
    expect(r.ok).toBe(true);
  });

  test("respeita maxAgeMinutes do options", () => {
    const r1 = verifyReplicas({
      snapshots: [snap({ replica: "b2", createdAt: "2026-04-29T10:00:00Z" })],
      expectedReplicas: ["b2"],
      maxAgeMinutes: 90,
      now: NOW,
    });
    expect(r1.ok).toBe(false); // 120min > 90min
    const r2 = verifyReplicas({
      snapshots: [snap({ replica: "b2", createdAt: "2026-04-29T10:00:00Z" })],
      expectedReplicas: ["b2"],
      maxAgeMinutes: 180,
      now: NOW,
    });
    expect(r2.ok).toBe(true); // 120min < 180min
  });

  test("expectedReplicas vazio retorna ok=true (vacuously)", () => {
    const r = verifyReplicas({
      snapshots: [],
      expectedReplicas: [],
      maxAgeMinutes: 60,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.replicas.length).toBe(0);
  });

  test("retorna latestGeneration do snapshot mais recente", () => {
    const r = verifyReplicas({
      snapshots: [
        snap({ replica: "b2", generation: "old-gen", createdAt: "2026-04-29T08:00:00Z" }),
        snap({ replica: "b2", generation: "new-gen", createdAt: "2026-04-29T11:30:00Z" }),
      ],
      expectedReplicas: ["b2"],
      maxAgeMinutes: 60,
      now: NOW,
    });
    expect(r.replicas[0]?.latestGeneration).toBe("new-gen");
  });
});
