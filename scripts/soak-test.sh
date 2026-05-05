#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: soak-test.sh [--once] [--burst-size N] [--interval-sec N] [--burst-interval-sec N]

Defaults:
  --interval-sec 300          (1 LOW task every 5 minutes)
  --burst-interval-sec 7200   (burst every 2 hours)
  --burst-size 10             (10 NORMAL tasks per burst)

Env overrides:
  CLAWDE_BIN       command used to enqueue tasks (default: clawde)
  CLAWDE_QUEUE_CMD extra args appended to queue calls (default: empty)
EOF
}

interval_sec=300
burst_interval_sec=7200
burst_size=10
run_once=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --once)
      run_once=1
      shift
      ;;
    --burst-size)
      burst_size="${2:-}"
      shift 2
      ;;
    --interval-sec)
      interval_sec="${2:-}"
      shift 2
      ;;
    --burst-interval-sec)
      burst_interval_sec="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "soak-test: unknown arg '$1'" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$interval_sec" =~ ^[0-9]+$ ]] || [[ "$interval_sec" -le 0 ]]; then
  echo "soak-test: --interval-sec must be > 0" >&2
  exit 2
fi
if ! [[ "$burst_interval_sec" =~ ^[0-9]+$ ]] || [[ "$burst_interval_sec" -le 0 ]]; then
  echo "soak-test: --burst-interval-sec must be > 0" >&2
  exit 2
fi
if ! [[ "$burst_size" =~ ^[0-9]+$ ]] || [[ "$burst_size" -le 0 ]]; then
  echo "soak-test: --burst-size must be > 0" >&2
  exit 2
fi

clawde_bin="${CLAWDE_BIN:-clawde}"
extra_queue_args="${CLAWDE_QUEUE_CMD:-}"
next_burst_epoch=$(( $(date +%s) + burst_interval_sec ))

queue_low() {
  # shellcheck disable=SC2086
  $clawde_bin queue "retorna a hora UTC atual" --priority LOW $extra_queue_args
}

queue_burst() {
  local i
  for i in $(seq 1 "$burst_size"); do
    # shellcheck disable=SC2086
    $clawde_bin queue "lista os 5 primeiros arquivos de \$PWD" --priority NORMAL $extra_queue_args
  done
}

echo "soak-test: started interval=${interval_sec}s burst_interval=${burst_interval_sec}s burst_size=${burst_size}"

while true; do
  queue_low

  now_epoch=$(date +%s)
  if [[ "$now_epoch" -ge "$next_burst_epoch" ]]; then
    queue_burst
    next_burst_epoch=$(( now_epoch + burst_interval_sec ))
    echo "soak-test: burst completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi

  if [[ "$run_once" -eq 1 ]]; then
    echo "soak-test: --once complete"
    exit 0
  fi

  sleep "$interval_sec"
done
