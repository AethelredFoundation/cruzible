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
    ;;
  gpg)
    sign_with_gpg
    signature_ext="asc"
    ;;
  *)
    echo "Unsupported SIGNING_BACKEND=${backend}; use cosign or gpg." >&2
    exit 1
    ;;
esac

generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "${artifact_dir}/signatures.json" <<EOF
{
  "schema": "cruzible.contract_artifact_signatures.v1",
  "generated_at": "${generated_at}",
  "signer_id": "${signer_id}",
  "backend": "${backend}",
  "entries": [
    {
      "file": "SHA256SUMS",
      "signature": "SHA256SUMS.${signature_ext}"
    },
    {
      "file": "manifest.json",
      "signature": "manifest.json.${signature_ext}"
    }
  ]
}
EOF

echo "Signed contract audit artifacts in ${artifact_dir}"
