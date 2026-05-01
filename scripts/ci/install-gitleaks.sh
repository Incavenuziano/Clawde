#!/usr/bin/env bash
set -euo pipefail

VERSION="${GITLEAKS_VERSION:-8.30.1}"
INSTALL_DIR="${1:-${RUNNER_TEMP:-/tmp}/gitleaks-bin}"

mkdir -p "${INSTALL_DIR}"

ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64|amd64) ARCH_SUFFIX="x64" ;;
  aarch64|arm64) ARCH_SUFFIX="arm64" ;;
  *)
    echo "Unsupported architecture for gitleaks install: ${ARCH}" >&2
    exit 1
    ;;
esac

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
if [[ "${OS}" != "linux" ]]; then
  echo "Unsupported OS for gitleaks install script: ${OS}" >&2
  exit 1
fi

TARBALL="gitleaks_${VERSION}_${OS}_${ARCH_SUFFIX}.tar.gz"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${TARBALL}"

curl --fail --silent --show-error --location "${URL}" --output "/tmp/${TARBALL}"
tar -xzf "/tmp/${TARBALL}" -C "${INSTALL_DIR}" gitleaks
chmod +x "${INSTALL_DIR}/gitleaks"

echo "${INSTALL_DIR}"
