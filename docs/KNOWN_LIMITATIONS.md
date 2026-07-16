# Known Limitations and Untested Assumptions

Companion to [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md)
(rev. 2). These are the risks the current evidence does **not** eliminate.
Client-facing material must not claim otherwise.

## Environment and scope

1. **Single-node devnet.** Every live proof and the load test ran on one
   validator. Consensus faults, partitions, validator churn, slashing
   drills, upgrade skew, and recovery are untested (Gate 3).
2. **Not a capacity benchmark.** 2.7 tx/s is the single node's block rate;
   no submission-to-finality latency distribution, soak, or thundering-herd
   measurement exists yet.
3. **Public testnet does not yet expose the staking/distribution
   precompiles.** Merged to the release branch; activation needs a validator
   binary upgrade plus a governance param update or re-genesis. Until then,
   Phase-2 functions revert there.
4. **Cross-VM atomicity is trusted, not fault-injected.** EVM↔staking-module
   consistency is exercised on the happy path live and via mocks in Foundry;
   systematic fault injection at the precompile boundary (out-of-gas at each
   stage, module rejection, duplicated retries) is a Gate 3 campaign item.
   The precompile interface is not yet version-negotiated by the vault.

## Cryptography and identity

5. **ZeroID ZK artifacts use a development ceremony beacon.** Not
   production-trustworthy until the multi-party ceremony + independent
   transcript verification complete (Gate 6). The identity gate tested here
   uses the on-chain registry (status flags), not ZK proofs.
6. **Address-level verification cannot see beneficial owners.** Verified
   contracts, omnibus wallets, delegated accounts — see IDENTITY_POLICY.md
   Models B/C for the accepted residuals.
7. **The seal-quorum admission path (`stakeWithSeal`) has no multi-validator
   E2E** (single node cannot mint a quorum seal). Foundry + real-precompile
   Go proofs exist; the live path is Gate 3.

## Guarantees' fine print

8. **"Exits always work" assumes chain availability.** A chain halt,
   consensus failure, or gas exhaustion stops all execution, including
   exits. The guarantee is: no _contract-level_ condition (identity, pause,
   registry, governance) gates exits.
9. **Revocation is execution-order-based.** A stake ordered before the
   revocation in the same block succeeds. UI verification chips poll and can
   be ~30s stale; the contract check is authoritative.
10. **Slash allocation at lifecycle edges:** active shares socialize losses;
    amounts already reserved for queued exits do NOT re-socialize
    (fixed-at-request-time, both directions, test-pinned). A user who exits
    before a slash is reconciled avoids that loss — mitigated by
    permissionless, idempotent `reconcileValidator` (anyone can realize a
    known slash immediately); a keeper/monitoring SLO for prompt
    reconciliation is a Gate 8 item.
11. **Model B residual:** wstAETHEL remains freely transferable; unverified
    parties can hold wrapper value but can never unwrap or reach the vault
    (IDENTITY_POLICY.md).

## Assurance and operations

12. **All review to date is self-review.** No independent audit of the
    contracts, circuits, wallet, or backend has been performed (Gate 4).
13. **Dependency checks are point-in-time** and do not establish build
    provenance, CI integrity, or continuous monitoring (Gate 9). Whether the
    flagged `uuid` version executes during mobile build/packaging is
    unverified.
14. **Governance on all test deployments is single-key.** Multisig/timelock
    deployment and drills are Gate 5.
15. **No production monitoring, alerting, on-call, or incident runbooks are
    live** for the keeper functions or solvency deltas (Gate 8).
16. **ZeroID SaaS backend posture** (multi-region, backups, tenant
    isolation, issuer-key HSM, privacy data-flow) is unassessed in this
    audit (Gate 6).
17. **Wallet is v0.9.x beta:** no store distribution, reproducible signed
    builds, staged rollout, or extension penetration test yet (Gate 7).
