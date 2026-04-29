/**
 * `clawde replica status|verify` — saúde da replicação Litestream (Fase 8).
 *
 * status:  lista snapshots + age. Exit 0 sempre exceto erro fatal.
 * verify:  exit 0 se todos os replicas frescos (< maxAgeMin), 1 caso contrário.
 *
 * Aceita injection do runner pra teste (`__runnerOverride`).
 */

import {
  LitestreamError,
  type LitestreamRunner,
  defaultLitestreamRunner,
  listSnapshots,
  verifyReplicas,
} from "@clawde/replica";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface ReplicaCmdOptions {
  readonly format: OutputFormat;
  readonly action: "status" | "verify";
  readonly dbPath: string;
  readonly expectedReplicas: ReadonlyArray<string>;
  readonly maxAgeMinutes?: number;
  /** Test hook: substitui spawn de litestream. */
  readonly __runnerOverride?: LitestreamRunner;
}

export async function runReplica(options: ReplicaCmdOptions): Promise<number> {
  const runner = options.__runnerOverride ?? defaultLitestreamRunner;
  const maxAgeMinutes = options.maxAgeMinutes ?? 90; // 1h snapshot + folga

  let snapshots: Awaited<ReturnType<typeof listSnapshots>>;
  try {
    snapshots = await listSnapshots(options.dbPath, runner);
  } catch (err) {
    if (err instanceof LitestreamError) {
      emitErr(`error: ${err.message}${err.stderr ? ` — ${err.stderr}` : ""}`);
    } else {
      emitErr(`error: ${(err as Error).message}`);
    }
    return 2;
  }

  if (options.action === "status") {
    emit(options.format, { dbPath: options.dbPath, snapshots }, (d) => {
      const data = d as { dbPath: string; snapshots: typeof snapshots };
      if (data.snapshots.length === 0) return `(no snapshots for ${data.dbPath})`;
      const lines: string[] = [`db: ${data.dbPath}`, ""];
      for (const s of data.snapshots) {
        lines.push(
          `  ${s.replica.padEnd(16)} gen=${s.generation.slice(0, 12)} idx=${s.index} size=${s.size}B at=${s.createdAt}`,
        );
      }
      return lines.join("\n");
    });
    return 0;
  }

  // verify
  const report = verifyReplicas({
    snapshots,
    expectedReplicas: options.expectedReplicas,
    maxAgeMinutes,
  });

  emit(options.format, report, (d) => {
    const r = d as typeof report;
    const lines: string[] = [
      `max_age:    ${r.maxAgeMinutes}min`,
      `overall:    ${r.ok ? "OK" : "FAIL"}`,
      "",
    ];
    for (const rs of r.replicas) {
      const tag = rs.fresh ? "OK" : rs.hasSnapshot ? "STALE" : "MISSING";
      const ageStr = rs.ageMinutes !== null ? `${rs.ageMinutes}min` : "(no data)";
      lines.push(
        `  [${tag.padEnd(7)}] ${rs.replica.padEnd(16)} latest=${rs.latestCreatedAt ?? "-"} age=${ageStr} count=${rs.snapshotCount}`,
      );
    }
    return lines.join("\n");
  });

  return report.ok ? 0 : 1;
}
