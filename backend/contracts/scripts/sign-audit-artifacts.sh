#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-audit-artifacts/contracts}"
backend="${SIGNING_BACKEND:-cosign}"
signer_id="${SIGNER_ID:-}"

if [ -z "${signer_id}" ]; then
  echo "SIGNER_ID is required, for example SIGNER_ID=aethelred-contracts-release" >&2
  exit 1
fi

case "${signer_id}" in
  *[!A-Za-z0-9._@:/+=-]*)
    echo "SIGNER_ID contains unsupported characters for signatures.json" >&2
    exit 1
    ;;
esac

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

sign_with_cosign() {
  if ! command -v cosign >/dev/null 2>&1; then
    echo "cosign is required when SIGNING_BACKEND=cosign" >&2
    exit 1
  fi
  if [ -z "${COSIGN_PRIVATE_KEY:-}" ]; then
    echo "COSIGN_PRIVATE_KEY is required when SIGNING_BACKEND=cosign" >&2
    exit 1
  fi

  for payload in SHA256SUMS manifest.json; do
    cosign sign-blob \
      --yes \
      --key env://COSIGN_PRIVATE_KEY \
      --output-signature "${artifact_dir}/${payload}.sig" \
      "${artifact_dir}/${payload}"
  done
}

sign_with_cosign_keyless() {
  if ! command -v cosign >/dev/null 2>&1; then
    echo "cosign is required when SIGNING_BACKEND=cosign-keyless" >&2
    exit 1
  fi

  for payload in SHA256SUMS manifest.json; do
    cosign sign-blob \
      --yes \
      --output-signature "${artifact_dir}/${payload}.sig" \
      --output-certificate "${artifact_dir}/${payload}.pem" \
      "${artifact_dir}/${payload}"
  done
}

sign_with_gpg() {
  if ! command -v gpg >/dev/null 2>&1; then
    echo "gpg is required when SIGNING_BACKEND=gpg" >&2
    exit 1
  fi

  gpg_key="${GPG_SIGNING_KEY:-${signer_id}}"
  for payload in SHA256SUMS manifest.json; do
    gpg --batch --yes --armor \
      --local-user "${gpg_key}" \
      --output "${artifact_dir}/${payload}.asc" \
      --detach-sign "${artifact_dir}/${payload}"
  done
}

case "${backend}" in
  cosign)
    sign_with_cosign
    signature_ext="sig"
    certificate_ext=""
    ;;
  cosign-keyless)
    sign_with_cosign_keyless
    signature_ext="sig"
    certificate_ext="pem"
    ;;
  gpg)
    sign_with_gpg
    signature_ext="asc"
    certificate_ext=""
    ;;
  *)
    echo "Unsupported SIGNING_BACKEND=${backend}; use cosign, cosign-keyless, or gpg." >&2
    exit 1
    ;;
esac

generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

write_signature_entry() {
  payload="${1}"
  printf '    {\n'
  printf '      "file": "%s",\n' "${payload}"
  printf '      "signature": "%s.%s"' "${payload}" "${signature_ext}"
  if [ -n "${certificate_ext}" ]; then
    printf ',\n'
    printf '      "certificate": "%s.%s"\n' "${payload}" "${certificate_ext}"
  else
    printf '\n'
  fi
  printf '    }'
}

{
  printf '{\n'
  printf '  "schema": "cruzible.contract_artifact_signatures.v1",\n'
  printf '  "generated_at": "%s",\n' "${generated_at}"
  printf '  "signer_id": "%s",\n' "${signer_id}"
  printf '  "backend": "%s",\n' "${backend}"
  printf '  "entries": [\n'
  write_signature_entry "SHA256SUMS"
  printf ',\n'
  write_signature_entry "manifest.json"
  printf '\n'
  printf '  ]\n'
  printf '}\n'
} > "${artifact_dir}/signatures.json"

echo "Signed contract audit artifacts in ${artifact_dir}"
