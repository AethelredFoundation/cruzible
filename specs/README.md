# Cruzible Protocol Specs

This directory defines the phase-1 cross-language payload surface for the
Cruzible protocol SDKs.

Scope:

- Canonical validator-selection attestation payload
- Canonical reward attestation payload
- Canonical delegation attestation payload
- Canonical SHA-256 hashes used to derive those payloads
- Phase-2 staker and delegation registry roots

Non-scope for this first SDK cut:

- Merkle proof generation
- TEE attestation verification
- Full TEE verification and relay orchestration

Those pieces remain authoritative in the audited Rust, Go, and Solidity code.
The TypeScript and Python packages added in this workspace consume or assemble
the canonical payloads from already-derived roots and hashes.
