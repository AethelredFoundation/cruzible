# Smart Contract Test Coverage Report

## Current Test Evidence

Local command:

```bash
cd backend/contracts
cargo test
```

Observed result: **312 passing unit tests**.

| Suite            | Passing tests |
| ---------------- | ------------: |
| `vault`          |            34 |
| `ai_job_manager` |            72 |
| `cw20_staking`   |            53 |
| `governance`     |            53 |
| `model_registry` |            54 |
| `seal_manager`   |            46 |
| Doc tests        |             0 |
| **Total**        |       **312** |

## Covered Remediation Themes

The passing test set includes coverage for the current hardening work:

- Vault reward index and reward double-claim prevention.
- Vault unbonding claim-state handling and slash-adjusted pending claim amounts.
- Vault stAETHEL mint/burn lifecycle, unstake reward settlement, and transfer-synchronized accounting for direct and delegated transfers.
- Vault rounding behavior.
- Vault donation/accounted-balance controls.
- AI job Paid-state double-claim guard.
- Governance snapshot, quorum, feeder oracle, and governance-controlled feeder membership controls.
- Model registry registration fee amount and denom enforcement.
- Model registry job-manager authorization, AI job manager submit-time verified-model checks, and liveness-safe verified-job count updates.
- Seal manager cross-contract job verification, job evidence binding, and bounded expiration.

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
bash scripts/build-optimized-artifacts.sh
```

These commands are enforced by CI. The optimized wasm files, `SHA256SUMS`, and
`manifest.json` are uploaded as commit-scoped CI artifacts and should be
archived with the audit-candidate package.
