# Cruzible Smart Contract Assurance Report

## Executive Summary

This report summarizes the current internal assurance position for the CosmWasm workspace under `backend/contracts`.

Status: **audit-candidate / pre-production hardening**.

The prior critical findings tracked for this workspace have been remediated in live code and covered by local tests. This documentation does not claim mainnet readiness. The contracts remain pre-production until external audit, deployment scripts, staging validation, real chain integration, and remaining TODOs are closed.

## Scope

Contracts in scope:

- `vault`
- `ai_job_manager`
- `cw20_staking`
- `governance`
- `model_registry`
- `seal_manager`

Supporting assurance documents:

- `SECURITY_AUDIT.md`
- `SECURITY_COMPLIANCE_REPORT.md`
- `TEST_COVERAGE.md`
- `README.md`

## Remediation Evidence

The current code includes remediations for the previously tracked critical and high-risk areas:

| Area                      | Current evidence                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Vault reward accounting   | Reward index/checkpoint controls prevent repeat reward claims and stale pro-rata reward capture.                  |
| Vault withdrawal claims   | Claimed-state handling and terminal request state prevent double claim of unbonding requests.                     |
| Vault rounding            | Share mint/burn rounding is protocol-favorable and covered by security tests.                                     |
| Vault stAETHEL lifecycle  | Stake, compound, and restake mint stAETHEL; unstake burns stAETHEL through the configured staking token contract. |
| Vault donation controls   | Accounted balance tracking and donation controls prevent direct-transfer share price inflation.                   |
| AI job payment claims     | Paid-state transition prevents repeated settlement of the same verified job.                                      |
| Governance voting         | Snapshot voting power and quorum controls replace placeholder voting and execution logic.                         |
| Governance feeder oracle  | Multi-feeder median consensus rejects unsafe quorum, tolerance, feeder capacity, and authority settings.          |
| Model registry fees       | Registration fee enforcement is active.                                                                           |
| Model registry job counts | Job-count mutation is restricted to the authorized job manager.                                                   |
| Seal manager provenance   | Seal creation verifies the referenced job through the configured job manager.                                     |

## Current Test Evidence

Local command run from `backend/contracts`:

```bash
cargo test
```

Passing test counts:

| Suite            | Passing tests |
| ---------------- | ------------: |
| `vault`          |            24 |
| `ai_job_manager` |            52 |
| `cw20_staking`   |            42 |
| `governance`     |            49 |
| `model_registry` |            47 |
| `seal_manager`   |            27 |
| Doc tests        |             0 |
| **Total**        |       **241** |

## Audit-Candidate Readiness

The workspace is suitable for an external audit candidate branch after the following evidence is packaged:

- Current source tree and Cargo lockfile.
- Reproducible `cargo test` output showing 241 passing tests.
- Commit-scoped wasm artifacts, `SHA256SUMS`, and `manifest.json` from CI.
- Detached artifact signatures generated with `RELEASE_SIGNING.md` before launch.
- Strict release manifest reconciliation against the signed artifact directory.
- This assurance report and the related security/test coverage documents.
- `AUDIT_PACKET.md` with residual review items, deployment assumptions, staging drill, and release manifest template.

## Not Yet Production Ready

The following remain launch blockers:

- Independent external security audit.
- Deployment scripts and repeatable artifact generation.
- Production release-key signing of wasm artifact checksums and manifests.
- Staging validation against a real chain environment.
- Real cross-contract integration on the target chain.
- Closure or explicit risk acceptance for residual review items in `AUDIT_PACKET.md`.
- Operational runbooks for keys, upgrades, pauses, monitoring, and incident response.

## Recommended Next Steps

1. Freeze the audit-candidate scope and avoid feature churn during review.
2. Capture reproducible build and test logs in CI.
3. Run external audit with emphasis on cross-contract invariants and economic safety.
4. Validate deployment and migration procedures on staging before any production decision.
