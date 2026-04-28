#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-audit-artifacts/contracts}"
backend="${SIGNING_BACKEND:-cosign}"

if [ ! -d "${artifact_dir}" ]; then
  echo "Artifact directory not found: ${artifact_dir}" >&2
  exit 1
fi

for payload in SHA256SUMS manifest.json; do
  if [ ! -f "${artifact_dir}/${payload}" ]; then
    echo "Missing ${payload}. Run scripts/prepare-audit-artifacts.sh first." >&2
    exit 1
  fi
done

verify_with_cosign() {
  if ! command -v cosign >/dev/null 2>&1; then
    echo "cosign is required when SIGNING_BACKEND=cosign" >&2
    exit 1
  fi

  if [ -n "${COSIGN_PUBLIC_KEY_FILE:-}" ]; then
    key_ref="${COSIGN_PUBLIC_KEY_FILE}"
  elif [ -n "${COSIGN_PUBLIC_KEY:-}" ]; then
    key_ref="env://COSIGN_PUBLIC_KEY"
  else
    echo "COSIGN_PUBLIC_KEY_FILE or COSIGN_PUBLIC_KEY is required for cosign verification" >&2
    exit 1
  fi

  for payload in SHA256SUMS manifest.json; do
    signature="${artifact_dir}/${payload}.sig"
    if [ ! -f "${signature}" ]; then
      echo "Missing detached signature: ${signature}" >&2
      exit 1
    fi

    cosign verify-blob \
      --key "${key_ref}" \
      --signature "${signature}" \
      "${artifact_dir}/${payload}"
  done
}

verify_with_gpg() {
  if ! command -v gpg >/dev/null 2>&1; then
    echo "gpg is required when SIGNING_BACKEND=gpg" >&2
    exit 1
  fi

  for payload in SHA256SUMS manifest.json; do
    signature="${artifact_dir}/${payload}.asc"
    if [ ! -f "${signature}" ]; then
      echo "Missing detached signature: ${signature}" >&2
      exit 1
    fi

    gpg --batch --verify "${signature}" "${artifact_dir}/${payload}"
  done
}

case "${backend}" in
  cosign)
    verify_with_cosign
    ;;
  gpg)
    verify_with_gpg
    ;;
  *)
    echo "Unsupported SIGNING_BACKEND=${backend}; use cosign or gpg." >&2
    exit 1
    ;;
esac

echo "Verified contract audit artifact signatures in ${artifact_dir}"
