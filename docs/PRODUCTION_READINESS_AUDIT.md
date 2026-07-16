# Production-Readiness Audit — Aethelred Wallet ⇄ Cruzible ⇄ ZeroID

**Date:** 2026-07-11 (rev. 2, incorporating external consultant review of
rev. 1) · **Scope:** the three-way integration (identity-gated liquid
staking) across contract, wallet, and frontend layers
**Client bar:** sovereign and regulated top enterprises
**Method:** adversarial code review, fuzz + negative testing, randomized
in-EVM operation storm, a concurrent functional load test on a devnet, full
regression of every suite, dependency audit. Immutable identifiers (commit
SHAs, commands, versions, addresses) for every result are in
[AUDIT_EVIDENCE_INDEX.md](AUDIT_EVIDENCE_INDEX.md); scope boundaries are in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## 1. Verdict

**Ready for controlled testing with named participants on a development
network.** Not ready for public-testnet claims until the production
precompiles are activated there, and not ready for mainnet value until the
production gates in [PRODUCTION_GATES.md](PRODUCTION_GATES.md) are closed.

**No correctness or solvency defects were detected in the executed test
scope** (the scope is enumerated in the evidence index; testing establishes
absence of the defects looked for, not universal correctness). The blocking
items are assurance, distributed-operation, and operational gates — not
known code defects.

## 2. Evidence (all executed 2026-07-11, all green)

| Layer        | Suite                                                                                                                                                                                                                                                                                                                                                            | Result                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Contracts    | Foundry: main + wstAETHEL + adversarial/fuzz/economic + identity-boundary (Models A/B)                                                                                                                                                                                                                                                                           | **59/59** (768 fuzz executions inside) |
| Contracts    | In-EVM accounting storm (60 randomized ops, 5 actors, invariant asserted after every op)                                                                                                                                                                                                                                                                         | solvency held every step               |
| Chain        | `go test` on the merged release branch (app + evmconfig + 5 precompile pkgs)                                                                                                                                                                                                                                                                                     | 7/7 packages ok                        |
| Wallet       | Extension vitest + chain-cosmos                                                                                                                                                                                                                                                                                                                                  | 1,939 + 47                             |
| Frontend     | Cruzible vitest + tsc                                                                                                                                                                                                                                                                                                                                            | 309/309, clean                         |
| Browser E2E  | three-way spec ×2 fresh deployments, ungated classic spec, 10 hermetic wallet specs                                                                                                                                                                                                                                                                              | all passed                             |
| Live proofs  | lifecycle, Phase-1, Phase-2 real yield, Phase-2.5 queue loop, identity gate vs real ZeroID.sol                                                                                                                                                                                                                                                                   | 5/5 passed                             |
| Load         | concurrent functional load test (below)                                                                                                                                                                                                                                                                                                                          | passed                                 |
| Dependencies | `npm audit --omit=dev` (cruzible): 0 known vulns · `pnpm audit --prod` (wallet): 1 moderate (`uuid` via Expo mobile build tooling). Runtime exposure and build-pipeline exposure are distinct: the package is absent from the shipped extension, but whether it executes during build/packaging is an open supply-chain item — tracked in PRODUCTION_GATES.md §9 | point-in-time check                    |

## 3. Concurrent functional load test (scripts/devnet-stress-test.mjs)

This is a **correctness-under-concurrency test, not a capacity or
distributed-systems benchmark** (that campaign is Gate 3). 16 independent
wallets against a freshly deployed, identity-gated vault on a live
single-node devnet: 12 concurrent ZeroID registrations, 4 rounds of
randomized concurrent stake / unstake / instant-exit traffic, a 4-wallet
unregistered control group attacking the gate throughout, and a mid-storm
governance suspension of two identities.

- **99 transactions; zero unauthorized admissions.** All 16 unregistered
  attempts and all 4 post-suspension attempts were rejected; suspended
  wallets retained full exit access.
- **Solvency identity exact to the wei after the run:**
  `balance == totalPooledAethel + totalReserved + merkleReserve`
  (18.408845661810273916 AETHEL on both sides).
- Read path under a 300-call concurrent burst: p50 46ms · p95 76ms ·
  p99 87ms (single node, local — not a geographic SLO measurement).
- 2.7 successful tx/s sustained — block-rate-bound on one node; production
  capacity targets belong to the multi-validator campaign (Gate 3).

## 4. Adversarial and economic findings (test/CruzibleAdversarial.t.sol)

Each behavior below is pinned by a permanent test:

1. **Rounding never favored the staker in any fuzzed run** — stake→unstake
   round-trips at an odd exchange rate returned at most the deposit.
2. **Instant exits are exact** — payout precisely value-minus-fee,
   buffer-bounded, solvency preserved (fuzzed).
3. **The decimal bridge rejected all fuzzed dust** — non-whole-uaethel
   amounts revert; whole multiples delegate.
4. **A reverting identity registry fails CLOSED for entry; contract-level
   exit methods keep working** (they are not conditioned on identity, pause,
   or registry state — assuming chain availability; a chain halt stops all
   execution, see KNOWN_LIMITATIONS).
5. **A misconfigured gate (EOA registry) fails closed, not open.**
6. **Donations cannot move the exchange rate** (rate reads the accumulator,
   never the balance).
7. **Reward-sandwich gain is bounded by the rate guard** (`maxRebaseBps` per
   report; interval-limited).
8. **Buffer races resolve to exactly one winner**; the loser reverts cleanly.
9. **100 dust queue entries settle fully via batchWithdraw** — no stuck
   reservations.
10. **Keeper functions are idempotent** — double-sync releases nothing
    twice; double-reconcile realizes a slash exactly once.

## 5. The identity-control boundary (resolved)

Per [IDENTITY_POLICY.md](IDENTITY_POLICY.md): **Model A** (identity-gated
primary issuance; receipt token freely transferable) is the explicit,
test-pinned default. **Model B** (identity-gated ownership: transfer
recipients must be verified, senders never checked, exits structurally
ungated, wrapper allowlist with a documented wstAETHEL residual) is
implemented and opt-in via `StAETHEL.setTransferGate(true)`. **Model C**
(custodian-held) is a contractual profile. Legal-hold requirements are
explicitly out of the base vault — see the policy document.

## 6. Revocation semantics (precise wording)

Once a suspension/revocation transaction has **executed**, every
subsequently ordered stake call fails — within the same block when the
revocation is ordered first. Transaction ordering inside a block is
consensus-determined; the guarantee is execution-order-based, not
wall-clock-based. Wallet/frontend surfaces poll (30s) and may briefly
display stale verification status; the contract check at execution time is
authoritative.

## 7. Standing guarantees (test-pinned, chain-availability assumed)

- Identity is checked at **stake execution time** — never cached.
- **Contract-level exit methods are not conditioned on identity, pause,
  registry state, or governance action.**
- Yield is earned on-chain (staking precompiles), never operator-typed; the
  push path is rate-guarded and interval-limited, which also bounds
  reward-timing extraction (§4.7).
- Exit liquidity is permissionless (deficit-computed undelegation);
  slashing is socialized pro-rata, reconciled idempotently against
  consensus state.
- The wallet shows users what they are signing (first-party intent
  decoding) and what they own (live on-chain position, no seeded data).

## 8. Path to production

The go/no-go gates, owners, and current status are maintained in
[PRODUCTION_GATES.md](PRODUCTION_GATES.md). The next milestone is
**public-testnet release-candidate readiness** (exact production binary,
precompiles activated, multi-validator campaign) — not additional
same-shaped unit tests and not a mainnet announcement.
