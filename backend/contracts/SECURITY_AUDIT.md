# Cruzible Smart Contract Security Audit Notes

## Executive Summary

This document records the current internal security review state for the Cruzible CosmWasm contracts.

Status: **audit-candidate / pre-production hardening**.

The previously identified critical issues have been remediated in the live contract code and are backed by local test evidence. This is not a mainnet-ready statement. Mainnet readiness requires external audit, deployment automation, staging validation, real chain integration, and closure of remaining TODOs.

## Scope

Contracts reviewed:

- `contracts/vault`
- `contracts/ai_job_manager`
- `contracts/cw20_staking`
- `contracts/governance`
- `contracts/model_registry`
- `contracts/seal_manager`

## Previously Critical Areas

| Area                        | Prior risk                                                          | Current status                                                                    |
| --------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Vault reward claims         | Repeat claims could over-withdraw rewards.                          | Remediated with reward index/checkpoint accounting.                               |
| Vault unbonding claims      | Unbonding requests could be double claimed.                         | Remediated with claimed-state handling and terminal claim flow.                   |
| Vault share rounding        | Small deposits/withdrawals could exploit rounding.                  | Remediated with protocol-favorable rounding behavior.                             |
| Vault liquid staking token  | Internal shares did not fully exercise stAETHEL mint/burn behavior. | Remediated with staking-token mint on stake/compound/restake and burn on unstake. |
| Vault donations             | Direct transfers could distort share price.                         | Remediated with accounted balance and donation controls.                          |
| AI job payment              | Verified job payment could be claimed repeatedly.                   | Remediated with Paid-state double-claim guard.                                    |
| Governance voting           | Placeholder voting power and quorum allowed capture.                | Remediated with snapshot/quorum controls.                                         |
| Governance feeder control   | Admin-only feeder membership could centralize oracle control.       | Remediated for production mode with governance-authorized feeder mutations.       |
| Model registry fees         | Registration fee was not enforced.                                  | Remediated with fee amount and denom validation.                                  |
| Model registry usage counts | Public job-count mutation could corrupt metrics.                    | Remediated with job-manager authorization and verified-job count updates.         |
| Seal provenance             | Seals could be created without verified upstream job evidence.      | Remediated with cross-contract job verification.                                  |

## Current Test Evidence

Local `cargo test` from `backend/contracts` passes:

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

## Residual Review Focus

The next audit pass should focus on:

- Cross-contract invariants between job verification, seal creation, model registry updates, and payment settlement.
- Economic safety around vault share accounting, donation handling, reward distribution, and unbonding.
- Governance snapshot integrity, quorum calculation, proposal execution authorization, and parameter bounds.
- Real chain behavior for bank sends, staking flows, contract instantiation, migration, and address configuration.
- Operational controls for admin, operator, pauser, verifier, and job-manager roles.

## Launch Blockers

The contracts should not be described as production ready or mainnet ready until the following are complete:

- External audit and remediation of audit findings.
- Reproducible deployment scripts and artifact checksums.
- Staging deployment on a real chain environment.
- End-to-end cross-contract integration validation.
- Passing CI evidence for tests, formatting, clippy, dependency audit, optimized wasm builds, and uploaded checksums.
- Closure or explicit risk acceptance for the residual review items in `AUDIT_PACKET.md`.

## Conclusion

The current contract set is an audit candidate with materially improved security posture compared with the prior review. It remains a pre-production hardening target, not a production approval.
