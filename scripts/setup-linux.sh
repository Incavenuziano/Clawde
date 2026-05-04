#!/usr/bin/env bash
set -euo pipefail

LIBC="glibc"
if ldd --version 2>&1 | grep -qi musl; then
  LIBC="musl"
fi

find_sdk_binary() {
  local pkg=""
  if [[ "$LIBC" == "musl" ]]; then
    pkg="@anthropic-ai/claude-agent-sdk-linux-x64-musl"
  else
    pkg="@anthropic-ai/claude-agent-sdk-linux-x64"
  fi

  bun -e "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/'); console.log(require.resolve('${pkg}/claude'));" 2>/dev/null || true
}

find_fallback_binary() {
  find "${HOME}/.bun" "${HOME}/.npm" "${HOME}/.local" \
    \( -path '*linux-x64/claude' -o -path '*linux-x64-musl/claude' \) 2>/dev/null |
    head -n 1 || true
}

CLAUDE_BIN="$(find_sdk_binary)"
if [[ -z "${CLAUDE_BIN}" ]]; then
  CLAUDE_BIN="$(find_fallback_binary)"
fi
if [[ -z "${CLAUDE_BIN}" ]]; then
  CLAUDE_BIN="$(which claude 2>/dev/null || true)"
fi
if [[ -z "${CLAUDE_BIN}" ]]; then
  echo "setup-linux.sh: ERROR — claude binary not found. Install via native installer." >&2
  exit 1
fi

mkdir -p "${HOME}/.clawde/bin" "${HOME}/.clawde/config"
ln -sf "${CLAUDE_BIN}" "${HOME}/.clawde/bin/claude"

CONFIG_PATH="${HOME}/.clawde/config/clawde.toml"
if [[ ! -f "${CONFIG_PATH}" ]]; then
  touch "${CONFIG_PATH}"
fi

worker_key_line="claude_executable_path = \"${HOME}/.clawde/bin/claude\""

has_uncommented_key() {
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*claude_executable_path[[:space:]]*=/ { found=1 }
    END { exit found ? 0 : 1 }
  ' "${CONFIG_PATH}"
}

has_worker_section() {
  awk '
    /^[[:space:]]*\[worker\][[:space:]]*$/ { found=1 }
    END { exit found ? 0 : 1 }
  ' "${CONFIG_PATH}"
}

insert_into_worker_section() {
  local tmp
  tmp="$(mktemp)"
  awk -v line="${worker_key_line}" '
    BEGIN {
      in_worker = 0
      inserted = 0
    }
    /^[[:space:]]*\[/ {
      if (in_worker && !inserted) {
        print line
        inserted = 1
      }
      in_worker = ($0 ~ /^[[:space:]]*\[worker\][[:space:]]*$/)
      print
      next
    }
    {
      print
    }
    END {
      if (in_worker && !inserted) {
        print line
      }
    }
  ' "${CONFIG_PATH}" > "${tmp}"
  mv "${tmp}" "${CONFIG_PATH}"
}

if ! has_uncommented_key; then
  if has_worker_section; then
    insert_into_worker_section
  else
    {
      printf '\n[worker]\n'
      printf '%s\n' "${worker_key_line}"
    } >> "${CONFIG_PATH}"
  fi
fi

echo "setup-linux.sh: OK — claude binary at ${HOME}/.clawde/bin/claude"
