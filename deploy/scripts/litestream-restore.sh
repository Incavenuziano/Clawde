#!/usr/bin/env bash
# litestream-restore.sh — restaura state.db da replica remota.
#
# Uso:
#   ./litestream-restore.sh [--replica b2] [--target ~/.clawde/state.db]
#
# Pré-requisitos:
#   - litestream binário no PATH
#   - ~/.clawde/config/litestream.env com credenciais
#   - ~/.clawde/deploy/litestream/litestream.yml configurado
#
# IMPORTANTE: aborta se target já existe (proteção contra overwrite acidental).
# Use --force pra sobrescrever.

set -euo pipefail

REPLICA="b2"
TARGET="${HOME}/.clawde/state.db"
CONFIG="${HOME}/.clawde/deploy/litestream/litestream.yml"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --replica) REPLICA="$2"; shift 2 ;;
    --target)  TARGET="$2"; shift 2 ;;
    --config)  CONFIG="$2"; shift 2 ;;
    --force)   FORCE=1; shift ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if ! command -v litestream >/dev/null 2>&1; then
  echo "error: litestream not in PATH" >&2
  exit 3
fi

if [[ -e "${TARGET}" && "${FORCE}" -ne 1 ]]; then
  echo "error: ${TARGET} exists. use --force to overwrite." >&2
  exit 4
fi

if [[ ! -f "${CONFIG}" ]]; then
  echo "error: config not found: ${CONFIG}" >&2
  exit 5
fi

# Carrega env vars (LITESTREAM_ACCESS_KEY_ID etc) se arquivo existir.
ENV_FILE="${HOME}/.clawde/config/litestream.env"
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
fi

echo "restoring ${TARGET} from replica=${REPLICA} ..."
litestream restore -config "${CONFIG}" -replica "${REPLICA}" -o "${TARGET}" "${TARGET}"
echo "restore complete: ${TARGET}"
echo "verify with: sqlite3 ${TARGET} 'PRAGMA integrity_check'"
