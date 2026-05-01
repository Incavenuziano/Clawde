#!/usr/bin/env bash
set -euo pipefail

start_epoch="$(date +%s)"

usage() {
  cat <<'EOF'
Usage: backup-snapshot.sh [DEST] [--gzip]

DEST can be passed as first arg or via BACKUP_DEST.
EOF
}

dest=""
gzip_enabled="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gzip)
      gzip_enabled="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$dest" ]]; then
        echo "backup-snapshot: unexpected arg '$1'" >&2
        usage >&2
        exit 2
      fi
      dest="$1"
      shift
      ;;
  esac
done

if [[ -z "$dest" ]]; then
  dest="${BACKUP_DEST:-}"
fi

if [[ -z "$dest" ]]; then
  echo "backup-snapshot: DEST not provided (arg or BACKUP_DEST)" >&2
  exit 2
fi

home_dir="${CLAWDE_HOME:-$HOME/.clawde}"
db_path="${CLAWDE_DB_PATH:-$home_dir/state.db}"
mkdir -p "$dest"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$dest/state-$ts.db"
sqlite3 "$db_path" ".backup '$backup_path'"

final_path="$backup_path"
if [[ "$gzip_enabled" == "1" ]]; then
  gzip -9 "$backup_path"
  final_path="${backup_path}.gz"
fi

size_bytes="$(stat -c%s "$final_path")"
end_epoch="$(date +%s)"
duration_seconds="$((end_epoch - start_epoch))"

printf '{"path":"%s","size_bytes":%s,"duration_seconds":%s}\n' \
  "$final_path" "$size_bytes" "$duration_seconds" >&2
