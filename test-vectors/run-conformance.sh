#!/usr/bin/env bash
#
# run-conformance.sh — Cross-language conformance test runner (Track 8)
#
# Runs the Cruzible canonical hash conformance tests across all SDK
# implementations (TypeScript, Python, Go) and reports a summary.
#
# Prerequisites:
#   - Node.js 18+ with npx available
#   - Python 3.10+ with pytest and pycryptodome installed
#   - Go 1.21+ with module dependencies resolved
#
# Usage:
#   cd test-vectors/
#   ./run-conformance.sh
#
# The script exits with code 0 if all suites pass, 1 otherwise.
#
set -uo pipefail
# Note: -e is intentionally omitted so the script continues after a suite fails.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRUZIBLE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AETHELRED_ROOT="$(cd "$CRUZIBLE_ROOT/../../.." && pwd)"

# Color codes (disabled if not a TTY)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  GREEN='' RED='' YELLOW='' BOLD='' NC=''
fi

passed=0
failed=0
skipped=0

run_suite() {
  local name="$1"
  local dir="$2"
  shift 2

  echo ""
  echo -e "${BOLD}[$name]${NC} Running from $dir"
  echo "  Command: $*"
  echo ""

  if [ ! -d "$dir" ]; then
    echo -e "  ${YELLOW}SKIP${NC}: directory $dir not found"
    skipped=$((skipped + 1))
    return
  fi

  if (cd "$dir" && "$@"); then
    echo ""
    echo -e "  ${GREEN}PASS${NC}: $name"
    passed=$((passed + 1))
  else
    echo ""
    echo -e "  ${RED}FAIL${NC}: $name"
    failed=$((failed + 1))
  fi
}

echo "=============================================="
echo " Cruzible Cross-Language Conformance (Track 8)"
echo "=============================================="
echo ""
echo "Cruzible root: $CRUZIBLE_ROOT"
echo "Aethelred root: $AETHELRED_ROOT"

# ── 1. TypeScript SDK ──────────────────────────────────────────────────────
run_suite "TypeScript SDK" \
  "$CRUZIBLE_ROOT/sdk/typescript" \
  sh -c "npx tsc -p tsconfig.json && node dist/test/conformance.test.js"

# ── 2. Python SDK ──────────────────────────────────────────────────────────
run_suite "Python SDK" \
  "$CRUZIBLE_ROOT/sdk/python" \
  python -m pytest tests/test_conformance.py -v

# ── 3. Go Keeper ───────────────────────────────────────────────────────────
run_suite "Go Keeper" \
  "$AETHELRED_ROOT" \
  go test ./x/vault/keeper/ -run TestConformance -v -count=1

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "=============================================="
echo -e " ${BOLD}Summary${NC}"
echo "=============================================="
echo -e "  Passed:  ${GREEN}${passed}${NC}"
echo -e "  Failed:  ${RED}${failed}${NC}"
echo -e "  Skipped: ${YELLOW}${skipped}${NC}"
echo ""

if [ "$failed" -gt 0 ]; then
  echo -e "${RED}CONFORMANCE FAILED${NC} — $failed suite(s) produced mismatches."
  echo ""
  echo "Next steps:"
  echo "  1. Check which hash function diverges (validator set, registry root, etc.)"
  echo "  2. Inspect encoding differences (uint256 vs uint64, address padding, endianness)"
  echo "  3. Use test-vectors/generate-expected.ts to regenerate canonical expected values"
  echo ""
  exit 1
else
  echo -e "${GREEN}ALL CONFORMANCE CHECKS PASSED${NC}"
  exit 0
fi
