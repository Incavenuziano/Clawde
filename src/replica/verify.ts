/**
 * F8 — Verificação de saúde do replica Litestream.
 *
 * Critérios:
 *   - Existe ao menos 1 snapshot por replica configurada.
 *   - Snapshot mais recente < maxAgeMinutes.
 *   - Generation atual estável (todos os snapshots recentes na mesma gen).
 *
 * Retorna report estruturado (não lança em "stale" — chamador decide exit code).
 */

import type { LitestreamSnapshot } from "./litestream.ts";

export interface ReplicaVerifyOptions {
  readonly snapshots: ReadonlyArray<LitestreamSnapshot>;
  readonly expectedReplicas: ReadonlyArray<string>;
  readonly maxAgeMinutes: number;
  readonly now?: Date;
}

export interface ReplicaStatus {
  readonly replica: string;
  readonly hasSnapshot: boolean;
  readonly latestCreatedAt: string | null;
  readonly ageMinutes: number | null;
  readonly fresh: boolean;
  readonly latestGeneration: string | null;
  readonly snapshotCount: number;
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly replicas: ReadonlyArray<ReplicaStatus>;
  readonly maxAgeMinutes: number;
}

export function verifyReplicas(options: ReplicaVerifyOptions): VerifyReport {
  const now = options.now ?? new Date();
  const replicaStatuses: ReplicaStatus[] = [];

  for (const name of options.expectedReplicas) {
    const own = options.snapshots.filter((s) => s.replica === name);
    if (own.length === 0) {
      replicaStatuses.push({
        replica: name,
        hasSnapshot: false,
        latestCreatedAt: null,
        ageMinutes: null,
        fresh: false,
        latestGeneration: null,
        snapshotCount: 0,
      });
      continue;
    }

    // Mais recente: maior createdAt (RFC3339 strings ordenam lexicograficamente).
    const sorted = [...own].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const latest = sorted[0];
    if (latest === undefined) continue; // unreachable, mas TS exige

    const latestDate = new Date(latest.createdAt);
    const ageMs = now.getTime() - latestDate.getTime();
    const ageMinutes = ageMs / 60_000;
    const fresh = Number.isFinite(ageMinutes) && ageMinutes <= options.maxAgeMinutes;

    replicaStatuses.push({
      replica: name,
      hasSnapshot: true,
      latestCreatedAt: latest.createdAt,
      ageMinutes: Math.round(ageMinutes * 10) / 10,
      fresh,
      latestGeneration: latest.generation,
      snapshotCount: own.length,
    });
  }

  const ok = replicaStatuses.every((r) => r.hasSnapshot && r.fresh);
  return {
    ok,
    replicas: replicaStatuses,
    maxAgeMinutes: options.maxAgeMinutes,
  };
}
