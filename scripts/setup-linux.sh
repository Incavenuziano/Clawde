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
if ! grep -q 'claude_executable_path' "${CONFIG_PATH}" 2>/dev/null; then
  {
    printf '\n[worker]\n'
    printf 'claude_executable_path = "%s"\n' "${HOME}/.clawde/bin/claude"
  } >> "${CONFIG_PATH}"
fi

echo "setup-linux.sh: OK — claude binary at ${HOME}/.clawde/bin/claude"
