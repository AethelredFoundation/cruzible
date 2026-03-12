#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# cargo-isolated.sh — Run cargo commands isolated from the monorepo vendor
#                     redirect that lives at aethelred/.cargo/config.toml.
#
# The monorepo vendored-sources directory does not include CosmWasm crates,
# so direct `cargo build/test` from this subdirectory fails.  This wrapper
# temporarily moves the parent config aside, runs the requested cargo
# command, and restores the parent config on exit (including on failure).
#
# Usage:
#   ./cargo-isolated.sh test --all
#   ./cargo-isolated.sh build --release
#   ./cargo-isolated.sh clippy --all-targets -- -D warnings
#   ./cargo-isolated.sh fmt --all -- --check
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Walk up to find the monorepo .cargo/config.toml
PARENT_CONFIG="$SCRIPT_DIR/../../../../.cargo/config.toml"
PARENT_BACKUP="$PARENT_CONFIG.bak"

# Safety: resolve to absolute path
PARENT_CONFIG="$(cd "$(dirname "$PARENT_CONFIG")" 2>/dev/null && echo "$(pwd)/$(basename "$PARENT_CONFIG")")" || true
PARENT_BACKUP="${PARENT_CONFIG}.bak"

# -------------------------------------------------------------------------
# Trap-guarded restore — always puts the parent config back, even on error.
# -------------------------------------------------------------------------
cleanup() {
  if [ -f "$PARENT_BACKUP" ]; then
    mv "$PARENT_BACKUP" "$PARENT_CONFIG"
  fi
}
trap cleanup EXIT

# -------------------------------------------------------------------------
# Temporarily disable the parent vendor redirect
# -------------------------------------------------------------------------
if [ -f "$PARENT_CONFIG" ]; then
  mv "$PARENT_CONFIG" "$PARENT_BACKUP"
fi

# -------------------------------------------------------------------------
# Run cargo from the contracts workspace directory
# -------------------------------------------------------------------------
cd "$SCRIPT_DIR"
cargo "$@"
