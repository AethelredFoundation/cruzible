#!/usr/bin/env bash
#
# backend/contracts-evm/build.sh — deterministic build of the Cruzible EVM
# contracts for the Aethelred EVM (ADR-0001 path; the CosmWasm workspace in
# backend/contracts is the earlier Cosmos-native track).
#
# Pinned toolchain: solc 0.8.20, optimizer on (200 runs), EVM target shanghai —
# identical settings to the chain repo's contracts/examples/build.sh so the
# artifacts are reproducible across both repos.
set -euo pipefail

cd "$(dirname "$0")"

SOLC="${SOLC:-solc}"
EXPECTED_VERSION="0.8.20"

version=$("$SOLC" --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [ "$version" != "$EXPECTED_VERSION" ]; then
  echo "ERROR: solc $EXPECTED_VERSION required, found $version" >&2
  exit 1
fi

mkdir -p artifacts

"$SOLC" \
  --via-ir --optimize --optimize-runs 200 \
  --evm-version shanghai \
  --bin --bin-runtime --abi \
  --overwrite \
  --base-path . \
  -o artifacts \
  src/Cruzible.sol src/StAETHEL.sol src/WstAETHEL.sol

echo "artifacts:"
ls -la artifacts/Cruzible.* artifacts/StAETHEL.* artifacts/WstAETHEL.*
shasum -a 256 \
  artifacts/Cruzible.bin artifacts/Cruzible.bin-runtime \
  artifacts/StAETHEL.bin artifacts/StAETHEL.bin-runtime
