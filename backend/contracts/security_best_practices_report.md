# Cruzible Smart Contract Audit Report

## Executive Summary

Audit scope for this pass was the CosmWasm workspace under `backend/contracts`, with primary focus on the liquid staking path (`vault`, `cw20_staking`) and the protocol-adjacent contracts that affect trust, governance, and escrow.

Verdict: **not production ready**.

- Overall protocol rating: **2.5 / 10**
- Critical findings: **5**
- High findings: **2**
- Medium findings: **2**

The largest problems are not cosmetic. Core trust boundaries are missing in multiple contracts: rewards can be over-withdrawn, job escrows can be claimed repeatedly, governance uses placeholder voting logic, seals are self-issued rather than derived from verified jobs, and TEE attestations are not cryptographically verified.

## Scope

Reviewed files:

- `backend/contracts/contracts/vault/src/lib.rs`
- `backend/contracts/contracts/cw20_staking/src/lib.rs`
- `backend/contracts/contracts/governance/src/lib.rs`
- `backend/contracts/contracts/model_registry/src/lib.rs`
- `backend/contracts/contracts/seal_manager/src/lib.rs`
- `backend/contracts/contracts/ai_job_manager/src/lib.rs`

Secondary evidence:

- `backend/contracts/contracts/vault/src/contract_tests.rs`
- `backend/contracts/contracts/ai_job_manager/src/contract_tests.rs`
- `backend/contracts/contracts/seal_manager/src/contract_tests.rs`
- `backend/contracts/TEST_COVERAGE.md`
- `backend/contracts/SECURITY_COMPLIANCE_REPORT.md`

## Contract Ratings

| Contract | Rating | Notes |
|---|---:|---|
| `vault` | 3/10 | Reward accounting is unsafe and the advertised liquid staking flow is not actually implemented |
| `cw20_staking` | 5/10 | Mostly standard token plumbing, but assurance quality is poor and some paths appear uncompilable |
| `governance` | 1/10 | Governance capture is trivial because vote weight and quorum are placeholders |
| `model_registry` | 4/10 | Low direct custody risk, but key economic and integrity controls are missing |
| `seal_manager` | 1/10 | Seals are not rooted in verified jobs or validator-authenticated evidence |
| `ai_job_manager` | 2/10 | Escrow, verification, and expiry handling are unsafe |

## Findings

### C-01: Vault reward pool can be drained by repeated claims

**Impact:** A staker can claim more than their fair share of the reward pool by calling `ClaimRewards` repeatedly, starving later claimants and draining nearly the full pool over multiple transactions.

**Evidence:**

- `execute_claim_rewards` deducts only the current pro-rata slice from `state.reward_pool`, but does not store any user checkpoint or claimed index: `backend/contracts/contracts/vault/src/lib.rs:529-555`
- `calculate_rewards` is purely `reward_pool * user_shares / total_shares`, so every subsequent claim recomputes a fresh share of the remaining pool: `backend/contracts/contracts/vault/src/lib.rs:806-815`

**Why this matters:** With 50% of shares and a 100-token reward pool, the first claim gets 50, then 25, then 12.5, and so on. The same user can converge toward the entire reward pool without changing stake.

**Recommendation:** Replace pool-proportional spot accounting with a cumulative reward index and a per-user reward debt/checkpoint.

### C-02: Verified job escrows can be claimed repeatedly

**Impact:** An assigned validator can call `ClaimPayment` more than once for the same verified job and drain escrowed funds from unrelated jobs as long as the contract balance remains positive.

**Evidence:**

- `ClaimPayment` checks only that the caller is the assigned validator and the job status is `Verified`: `backend/contracts/contracts/ai_job_manager/src/lib.rs:714-737`
- The function never marks the job as paid, never changes status, and never records a payment flag before emitting the bank sends: `backend/contracts/contracts/ai_job_manager/src/lib.rs:739-764`
- The contract even defines an `AlreadyClaimed` error, but that state is never wired into the payment path: `backend/contracts/contracts/ai_job_manager/src/lib.rs:60-61`

**Recommendation:** Add an explicit `paid` flag or post-payment terminal state, set it before external messages, and reject duplicate claims.

### C-03: Governance can be captured by arbitrary addresses

**Impact:** Protocol control can be seized without real stake. Any address gets the same hard-coded voting power, and quorum is never enforced at execution time.

**Evidence:**

- Every vote receives the same placeholder weight: `let weight = Uint128::from(1000000u128);`: `backend/contracts/contracts/governance/src/lib.rs:320-321`
- Execution explicitly bypasses quorum with `_quorum_met = true`: `backend/contracts/contracts/governance/src/lib.rs:365-371`

**Why this matters:** This is not a minor approximation. It nullifies token-weighted governance and makes proposal passage a function of address count and turnout engineering rather than stake.

**Recommendation:** Query real voting power from the staking or governance token source at a snapshot height, enforce quorum against total eligible voting power, and remove placeholder logic before deployment.

### C-04: Seal authenticity is not enforced

**Impact:** Any caller can mint a seal that queries as valid without proving the underlying job was real, verified, or approved by the claimed validators.

**Evidence:**

- `CreateSeal` accepts caller-supplied `job_id`, commitments, and validator addresses, then persists an `Active` seal with no cross-contract verification: `backend/contracts/contracts/seal_manager/src/lib.rs:190-239`
- `query_verify` only checks local status and optional expiry; it does not verify validator signatures, job completion, or provenance from `ai_job_manager`: `backend/contracts/contracts/seal_manager/src/lib.rs:436-455`
- `ExecuteMsg::VerifySeal` is a no-op success response, which further suggests verification is only nominal: `backend/contracts/contracts/seal_manager/src/lib.rs:175-180`

**Recommendation:** Seals should only be mintable from a trusted job-verification flow, and validity must be derived from authenticated validator evidence or a canonical upstream contract state.

### C-05: AI job verification accepts fabricated attestation data

**Impact:** A validator can submit arbitrary attestation bytes and get a job marked completed as long as the enum variant matches the configured TEE type.

**Evidence:**

- The attestation check only maps the enum to a byte and compares it to `required_tee_type`: `backend/contracts/contracts/ai_job_manager/src/lib.rs:550-560`
- No cryptographic quote verification, freshness check, measurement allowlist, signer verification, or model-registry query is performed before the job is accepted: `backend/contracts/contracts/ai_job_manager/src/lib.rs:550-582`
- Although the config stores `model_registry`, the submission flow never uses it and `InvalidModel` is dead code: `backend/contracts/contracts/ai_job_manager/src/lib.rs:54-55`, `backend/contracts/contracts/ai_job_manager/src/lib.rs:84`, `backend/contracts/contracts/ai_job_manager/src/lib.rs:347`, `backend/contracts/contracts/ai_job_manager/src/lib.rs:389-460`

**Recommendation:** Treat attestation verification as the core security boundary, not as metadata. Verify the quote, bind the attestation to the output and expected measurement, and enforce model existence/verification through the registry.

### H-01: Expiry cleanup can invalidate live jobs and strand user funds

**Impact:** Anyone can call `CleanupExpired` and mark stale queue entries as `Expired` even if they were already assigned, completed, or verified, which can block legitimate settlement. Expired pending jobs are also not actually refunded.

**Evidence:**

- `remove_from_pending` is stubbed out and never removes anything from the queue: `backend/contracts/contracts/ai_job_manager/src/lib.rs:973-975`
- `execute_assign_job` and `execute_cancel_job` both rely on that stub, so stale queue entries remain: `backend/contracts/contracts/ai_job_manager/src/lib.rs:487-490`, `backend/contracts/contracts/ai_job_manager/src/lib.rs:692-697`
- `execute_cleanup_expired` iterates queue entries and overwrites the loaded job status to `Expired` without checking the current state class: `backend/contracts/contracts/ai_job_manager/src/lib.rs:803-816`
- The refund branch is dead because the code first assigns `Expired` and only afterwards checks `if expired_job.status == JobStatus::Pending`: `backend/contracts/contracts/ai_job_manager/src/lib.rs:818-820`

**Recommendation:** Maintain a real pending set, only expire jobs still in `Pending` or another explicitly allowed state, and implement the refund before mutating away the original state.

### H-02: The advertised liquid staking flow is not actually implemented

**Impact:** Users do not receive transferable liquid staking tokens and deposited AETHEL is not delegated anywhere. The core product behavior described by Cruzible is therefore absent in the audited code.

**Evidence:**

- `execute_stake` only mutates local storage and returns attributes; it emits no CW20 mint and no staking/delegation message: `backend/contracts/contracts/vault/src/lib.rs:344-411`
- `execute_compound` calls `execute_claim_rewards` on a branched context and discards its `Response`, then tries to call `execute_stake` with the original `info` object, which contains no newly received funds: `backend/contracts/contracts/vault/src/lib.rs:558-575`

**Recommendation:** Either implement real delegation plus `stAETHEL` mint/burn flows, or remove liquid staking claims until that logic exists and is tested end to end.

### M-01: Model registry integrity and fee controls are missing

**Impact:** Anyone can inflate model usage metrics, and the configured registration fee is never collected. That weakens any ranking, fee, or reputation system built on this registry.

**Evidence:**

- `execute_register_model` loads `registration_fee` but never checks `info.funds`: `backend/contracts/contracts/model_registry/src/lib.rs:207-241`
- `IncrementJobCount` is public and has no caller authorization: `backend/contracts/contracts/model_registry/src/lib.rs:309-317`

**Recommendation:** Enforce the configured fee during registration and restrict usage-count mutation to a trusted upstream contract such as `ai_job_manager`.

### M-02: Assurance artifacts are materially unreliable

**Impact:** The repository claims production readiness and 100% test coverage, but the available evidence does not support those claims. This increases deployment risk because operators may rely on a false sense of assurance.

**Evidence:**

- `TEST_COVERAGE.md` claims every contract has 100% coverage and lists governance/model-registry/CW20 test suites: `backend/contracts/TEST_COVERAGE.md:7-15`
- In reality, only three `contract_tests.rs` files exist under the contracts workspace: `backend/contracts/contracts/vault/src/contract_tests.rs`, `backend/contracts/contracts/ai_job_manager/src/contract_tests.rs`, `backend/contracts/contracts/seal_manager/src/contract_tests.rs`
- The AI job manager tests reference a nonexistent `ContractError::InvalidFunds`: `backend/contracts/contracts/ai_job_manager/src/contract_tests.rs:139-140`, while the enum defines no such variant: `backend/contracts/contracts/ai_job_manager/src/lib.rs:25-62`
- The seal manager tests reference `new_seal.supersedes`, but `Seal` has no such field: `backend/contracts/contracts/seal_manager/src/contract_tests.rs:250-252`, `backend/contracts/contracts/seal_manager/src/lib.rs:46-61`
- `SECURITY_COMPLIANCE_REPORT.md` states the contracts are production ready with zero critical issues: `backend/contracts/SECURITY_COMPLIANCE_REPORT.md:7-13`

**Recommendation:** Rebuild the test suite from the live code, remove inaccurate security claims, and require reproducible CI evidence before any launch gating decision.

## Verification Limits

I attempted to run the workspace tests with `cargo test --all`, but build verification is currently blocked by the repository’s vendoring setup:

- the repo forces Cargo to use a local vendor directory: `/Users/rameshtamilselvan/Downloads/aethelred/.cargo/config.toml:1-5`
- the contracts depend on `cosmwasm-schema`: `backend/contracts/Cargo.toml:13`
- the local vendor directory does not contain any `cosmwasm-*` crates, and Cargo fails with `no matching package named 'cosmwasm-schema' found`

That limitation did **not** change the findings above; they were derived from direct source inspection and cross-checking the available test artifacts.

## Recommended Next Steps

1. Freeze any mainnet or public-testnet deployment plans for these contracts.
2. Repair the build pipeline and regenerate tests from the current sources.
3. Fix the five critical findings before spending time on optimization or UX.
4. After remediation, run a second pass focused on invariants, property tests, and adversarial integration tests across `vault`, `governance`, and `ai_job_manager`.
