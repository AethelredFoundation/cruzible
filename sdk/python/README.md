# Cruzible Python SDK

This package mirrors the phase-1 canonical payload utilities added for the
TypeScript SDK.

Included:

- canonical validator-set hash
- canonical selection-policy hash
- canonical eligible-universe hash
- canonical stake-snapshot hash
- staker registry root
- delegation registry root
- canonical validator, reward, and delegation payload builders
- epoch reconciliation helpers and CLI example

Excluded from this first cut:

- TEE verification
- Merkle proofs
- direct relay / attestation orchestration

Example:

```bash
PYTHONPATH=./sdk/python/src \
python3 ./sdk/python/examples/epoch_reconciliation.py \
  --input ./test-vectors/reconciliation/default.json \
  --json-out /tmp/cruzible-epoch-report.json \
  --md-out /tmp/cruzible-epoch-report.md
```
