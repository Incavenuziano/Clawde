/**
 * `clawde migrate` subcommand.
 * Suporta: up, status, down --target N --confirm.
 */

import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir, rollbackTo, status } from "@clawde/db/migrations";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface MigrateOptions {
  readonly dbPath: string;
  readonly migrationsDir?: string;
  readonly format: OutputFormat;
}

interface MigrateUpOptions extends MigrateOptions {
  readonly action: "up";
}

interface MigrateStatusOptions extends MigrateOptions {
  readonly action: "status";
}

interface MigrateDownOptions extends MigrateOptions {
  readonly action: "down";
  readonly target: number;
  readonly confirm: boolean;
}

export type MigrateAction = MigrateUpOptions | MigrateStatusOptions | MigrateDownOptions;

/**
 * Executa o subcomando. Retorna exit code (0 = sucesso, 1+ = erro).
 */
export function runMigrate(action: MigrateAction): number {
  const dir = action.migrationsDir ?? defaultMigrationsDir();
  let db: ClawdeDatabase;
  try {
    db = openDb(action.dbPath);
  } catch (err) {
    emitErr(`error: ${(err as Error).message}`);
    return 2;
  }
  try {
    if (action.action === "up") {
      const applied = applyPending(db, dir);
      emit(action.format, { applied: [...applied] }, (d) => {
        const data = d as { applied: number[] };
        if (data.applied.length === 0) {
          return "no migrations pending";
        }
        return `applied: ${data.applied.join(", ")}`;
      });
      return 0;
    }
    if (action.action === "status") {
      const s = status(db, dir);
      emit(action.format, s, (d) => {
        const data = d as ReturnType<typeof status>;
        const lines = [
          `current: ${data.current}`,
          `latest:  ${data.latest}`,
          `pending: ${data.pending.length === 0 ? "(none)" : data.pending.join(", ")}`,
        ];
        return lines.join("\n");
      });
      return 0;
    }
    // down
    if (!action.confirm) {
      emitErr("error: --confirm required for destructive rollback");
      return 1;
    }
    const reverted = rollbackTo(db, dir, action.target);
    emit(action.format, { reverted: [...reverted], target: action.target }, (d) => {
      const data = d as { reverted: number[]; target: number };
      if (data.reverted.length === 0) {
        return `no migrations reverted (already at ≤ ${data.target})`;
      }
      return `reverted: ${data.reverted.join(", ")} (target: ${data.target})`;
    });
    return 0;
  } catch (err) {
    emitErr(`error: ${(err as Error).message}`);
    return 2;
  } finally {
    closeDb(db);
  }
}
