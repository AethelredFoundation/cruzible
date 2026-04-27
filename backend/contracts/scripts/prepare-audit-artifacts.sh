#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-audit-artifacts/contracts}"
target_dir="${TARGET_DIR:-target/wasm32-unknown-unknown/release}"

if ! compgen -G "${target_dir}/*.wasm" >/dev/null; then
  echo "No wasm artifacts found in ${target_dir}. Run the release wasm build first." >&2
  exit 1
fi

mkdir -p "${artifact_dir}"
cp "${target_dir}"/*.wasm "${artifact_dir}/"

if command -v sha256sum >/dev/null 2>&1; then
  hash_cmd=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  hash_cmd=(shasum -a 256)
else
  echo "sha256sum or shasum is required to generate artifact checksums." >&2
  exit 1
fi

(
  cd "${artifact_dir}"
  "${hash_cmd[@]}" *.wasm > SHA256SUMS
)

git_commit="unknown"
if command -v git >/dev/null 2>&1; then
  git_commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
fi

generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
manifest_path="${artifact_dir}/manifest.json"

{
  printf '{\n'
  printf '  "schema": "cruzible.contract_audit_artifacts.v1",\n'
  printf '  "git_commit": "%s",\n' "${git_commit}"
  printf '  "generated_at": "%s",\n' "${generated_at}"
  printf '  "artifacts": [\n'

  first=1
  for wasm in "${artifact_dir}"/*.wasm; do
    file_name="$(basename "${wasm}")"
    checksum="$("${hash_cmd[@]}" "${wasm}" | awk '{print $1}')"
    bytes="$(wc -c < "${wasm}" | tr -d '[:space:]')"

    if [ "${first}" -eq 0 ]; then
      printf ',\n'
    fi
    first=0

    printf '    {\n'
    printf '      "file": "%s",\n' "${file_name}"
    printf '      "sha256": "%s",\n' "${checksum}"
    printf '      "bytes": %s\n' "${bytes}"
    printf '    }'
  done

  printf '\n'
  printf '  ]\n'
  printf '}\n'
} > "${manifest_path}"

echo "Prepared contract audit artifacts in ${artifact_dir}"
