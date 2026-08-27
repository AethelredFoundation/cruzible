#!/usr/bin/env bash
set -euo pipefail

OPTIMIZER_IMAGE="cosmwasm/optimizer:0.17.0@sha256:7e0b9229c1a4118d0c9a2af2e7f5d95a91f264c26a2ce5681c779926e74d7f85"
OPTIMIZER_PLATFORM="linux/amd64"

artifact_dir="${1:-audit-artifacts/contracts}"
contracts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
optimizer_image="${COSMWASM_OPTIMIZER_IMAGE:-${OPTIMIZER_IMAGE}}"
optimizer_platform="${COSMWASM_OPTIMIZER_PLATFORM:-${OPTIMIZER_PLATFORM}}"
cache_prefix="${COSMWASM_OPTIMIZER_CACHE_PREFIX:-cruzible_contracts}"

case "${optimizer_image}" in
  *@sha256:*) ;;
  *)
    echo "COSMWASM_OPTIMIZER_IMAGE must be pinned by sha256 digest." >&2
    exit 1
    ;;
esac

if [ "${optimizer_platform}" != "linux/amd64" ]; then
  echo "Production contract artifacts must be built with the linux/amd64 optimizer." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to build optimized CosmWasm artifacts." >&2
  exit 1
fi

(
  cd "${contracts_dir}"
  rm -rf artifacts

  docker run --rm \
    --platform "${optimizer_platform}" \
    -v "${contracts_dir}:/code" \
    --mount type=volume,source="${cache_prefix}_target",target=/target \
    --mount type=volume,source="${cache_prefix}_registry",target=/usr/local/cargo/registry \
    "${optimizer_image}"

  ARTIFACT_BUILDER_KIND=cosmwasm_optimizer \
    ARTIFACT_BUILDER_IMAGE="${optimizer_image}" \
    ARTIFACT_BUILDER_PLATFORM="${optimizer_platform}" \
    TARGET_DIR=artifacts \
    bash scripts/prepare-audit-artifacts.sh "${artifact_dir}"
)
