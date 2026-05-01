import type { ClawdeDatabase } from "./client.ts";

export interface ForeignKeyViolation {
  readonly table: string;
  readonly rowid: number;
  readonly parent: string;
  readonly fkid: number;
}

export interface DbIntegrityReport {
  readonly integrityCheck: string;
  readonly quickCheck: string;
  readonly foreignKeyViolations: ReadonlyArray<ForeignKeyViolation>;
  readonly elapsedMs: number;
}

export const SLOW_INTEGRITY_CHECK_MS = 1_000;

export function runDbIntegrityChecks(db: ClawdeDatabase): DbIntegrityReport {
  const startedAt = performance.now();
  const integrityRow = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
  const quickRow = db.query<{ quick_check: string }, []>("PRAGMA quick_check").get();
  const foreignKeyViolations = db.query<ForeignKeyViolation, []>("PRAGMA foreign_key_check").all();
  const elapsedMs = Math.round(performance.now() - startedAt);

  return {
    integrityCheck: integrityRow?.integrity_check ?? "(no result)",
    quickCheck: quickRow?.quick_check ?? "(no result)",
    foreignKeyViolations,
    elapsedMs,
  };
}

export function isDbIntegrityOk(report: DbIntegrityReport): boolean {
  return (
    report.integrityCheck === "ok" &&
    report.quickCheck === "ok" &&
    report.foreignKeyViolations.length === 0
  );
}
