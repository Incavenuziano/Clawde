#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: backup-prune.sh [BACKUP_ROOT]

BACKUP_ROOT defaults to $BACKUP_ROOT or ~/.clawde/backups.
Retention:
  hourly: keep 24
  daily:  keep 7
  weekly: keep 4
  monthly: never auto-pruned
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

backup_root="${1:-${BACKUP_ROOT:-$HOME/.clawde/backups}}"

hourly_dir="$backup_root/hourly"
daily_dir="$backup_root/daily"
weekly_dir="$backup_root/weekly"
monthly_dir="$backup_root/monthly"

mkdir -p "$hourly_dir" "$daily_dir" "$weekly_dir" "$monthly_dir"

prune_dir() {
  local dir="$1"
  local keep="$2"
  local removed=0
  mapfile -t files < <(find "$dir" -maxdepth 1 -type f -printf '%f\n' | sort -r)
  local index=0
  for filename in "${files[@]}"; do
    if (( index >= keep )); then
      rm -f "$dir/$filename"
      removed=$((removed + 1))
    fi
    index=$((index + 1))
  done
  echo "$removed"
}

hourly_removed="$(prune_dir "$hourly_dir" 24)"
daily_removed="$(prune_dir "$daily_dir" 7)"
weekly_removed="$(prune_dir "$weekly_dir" 4)"
total_removed="$((hourly_removed + daily_removed + weekly_removed))"

printf '{"backup_root":"%s","hourly_removed":%s,"daily_removed":%s,"weekly_removed":%s,"total_removed":%s}\n' \
  "$backup_root" "$hourly_removed" "$daily_removed" "$weekly_removed" "$total_removed" >&2
