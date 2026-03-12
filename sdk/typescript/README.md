# Cruzible TypeScript SDK

This package provides the phase-1 TypeScript encoding layer for Cruzible.

Included:

- canonical validator-set hash
- canonical selection-policy hash
- canonical eligible-universe hash
- canonical stake-snapshot hash
- staker registry root
- delegation registry root
- canonical validator, reward, and delegation attestation payload builders

Not included in this first cut:

- TEE quote verification
- Merkle tree generation
- Solidity contract integration helpers

Those remain authoritative in the audited Rust, Go, and Solidity code.
