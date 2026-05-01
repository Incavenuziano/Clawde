#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
SOURCE_HOOK="${ROOT_DIR}/.githooks/pre-commit"
TARGET_HOOK="${ROOT_DIR}/.git/hooks/pre-commit"

if [[ ! -f "${SOURCE_HOOK}" ]]; then
  echo "Hook template not found: ${SOURCE_HOOK}" >&2
  exit 1
fi

install -m 0755 "${SOURCE_HOOK}" "${TARGET_HOOK}"
echo "Installed pre-commit hook at ${TARGET_HOOK}"
