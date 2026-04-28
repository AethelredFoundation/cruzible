# Smart Contract Test Coverage Report

## Current Test Evidence

Local command:

```bash
cd backend/contracts
cargo test
```

Observed result: **244 passing tests**.

| Suite            | Passing tests |
| ---------------- | ------------: |
| `vault`          |            24 |
| `ai_job_manager` |            52 |
| `cw20_staking`   |            42 |
| `governance`     |            49 |
| `model_registry` |            50 |
| `seal_manager`   |            27 |
| Doc tests        |             0 |
| **Total**        |       **244** |

## Covered Remediation Themes

The passing test set includes coverage for the current hardening work:

- Vault reward index and reward double-claim prevention.
- Vault unbonding claim-state handling.
- Vault stAETHEL mint/burn lifecycle for stake, unstake, compound, and restake.
- Vault rounding behavior.
- Vault donation/accounted-balance controls.
- AI job Paid-state double-claim guard.
- Governance snapshot, quorum, feeder oracle, and governance-controlled feeder membership controls.
- Model registry registration fee amount and denom enforcement.
- Model registry job-manager authorization and AI job manager verified-job count updates.
- Seal manager cross-contract job verification.

## Coverage Limits

This document reports observed test counts, not measured line or branch coverage. It should not be read as a 100% coverage claim.

Additional evidence still required before production readiness:

- Passing CI logs for the same `cargo test`, formatting, clippy, dependency audit, and wasm build gates.
- Integration tests against deployed contracts on a staging chain.
- External audit review of economic and cross-contract invariants.

## Recommended Test Commands

```bash
cd backend/contracts
cargo test
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo build --release --target wasm32-unknown-unknown
```

These commands are enforced by CI. The wasm files, `SHA256SUMS`, and
`manifest.json` are uploaded as commit-scoped CI artifacts and should be
archived with the audit-candidate package.
