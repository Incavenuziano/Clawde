#!/usr/bin/env bash
set -euo pipefail

tmp_dir="/tmp/clawde-drill-$RANDOM"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

home_dir="${CLAWDE_HOME:-$HOME/.clawde}"
weekly_dir="${CLAWDE_BACKUP_WEEKLY_DIR:-$home_dir/backups/weekly}"

mkdir -p "$tmp_dir"

latest_entry="$(
  find "$weekly_dir" -maxdepth 1 -type f \( -name 'state-*.db' -o -name 'state-*.db.gz' \) -printf '%f\n' \
    | sort \
    | tail -n1
)"

if [[ -z "$latest_entry" ]]; then
  echo "restore-drill: no backup found in $weekly_dir" >&2
  exit 1
fi

latest_path="$weekly_dir/$latest_entry"
snapshot_db="$tmp_dir/snapshot.db"
restored_db="$tmp_dir/restored.db"

if [[ "$latest_path" == *.gz ]]; then
  gunzip -c "$latest_path" > "$snapshot_db"
else
  cp "$latest_path" "$snapshot_db"
fi

sqlite3 "$snapshot_db" ".backup '$restored_db'"

snapshot_ts="$(echo "$latest_entry" | sed -E 's/^state-([0-9]{8}T[0-9]{6}Z)\.db(\.gz)?$/\1/')"

SNAPSHOT_DB="$snapshot_db" RESTORED_DB="$restored_db" SNAPSHOT_TS="$snapshot_ts" bun --eval '
import { Database } from "bun:sqlite";

const snapshotPath = process.env.SNAPSHOT_DB;
const restoredPath = process.env.RESTORED_DB;
if (snapshotPath === undefined || restoredPath === undefined) {
  console.error("restore-drill: missing DB env paths");
  process.exit(1);
}

const tables = ["events", "quota_ledger", "messages"] as const;
const snapshot = new Database(snapshotPath, { readonly: true });
const restored = new Database(restoredPath, { readonly: true });

try {
  const integrity = restored.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
  if ((integrity?.integrity_check ?? "") !== "ok") {
    console.error(`restore-drill: integrity_check failed (${integrity?.integrity_check ?? "unknown"})`);
    process.exit(1);
  }

  for (const table of tables) {
    const sourceCount = Number(
      snapshot.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0,
    );
    const restoredCount = Number(
      restored.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0,
    );
    if (sourceCount !== restoredCount) {
      console.error(
        `restore-drill: count mismatch table=${table} snapshot=${sourceCount} restored=${restoredCount}`,
      );
      process.exit(1);
    }
  }

  const ts = process.env.SNAPSHOT_TS ?? "unknown";
  console.log(`restore-drill: OK snapshot_ts=${ts}`);
} finally {
  snapshot.close();
  restored.close();
}
'
