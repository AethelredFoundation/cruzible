# Production-Readiness Audit — Aethelred Wallet ⇄ Cruzible ⇄ ZeroID

**Date:** 2026-07-11 · **Scope:** the three-way integration (identity-gated
liquid staking) across contract, wallet, and frontend layers
**Client bar:** sovereign and regulated top enterprises
**Method:** adversarial code review, fuzz + negative testing, randomized
in-EVM operation storm, live concurrent stress test on a devnet, full
regression of every suite, dependency audit. Every claim below is backed by
a runnable artifact in this repo or the wallet repo.

## 1. Verdict

**PILOT-READY — production-conditional.** The integration is correct,
adversarially tested, and holds its invariants under concurrent load. It is
ready for supervised pilots with named counterparties on the testnet today.
It is **not** yet ready for unsupervised production custody of client funds:
the blocking items are external assurance and multi-validator operations
(section 5), not code defects — the audit found **zero** correctness or
solvency defects.

## 2. Evidence run on 2026-07-11 (all green)

| Layer        | Suite                                                                                          | Result                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Contracts    | Foundry: main + wstAETHEL + **adversarial/fuzz**                                               | **49/49** (768 fuzz executions inside)                                                                                 |
| Contracts    | In-EVM accounting storm (60 randomized ops, 5 actors, invariant asserted after every op)       | solvency held every step                                                                                               |
| Chain        | `go test` on merged release branch (app + evmconfig + 5 precompile pkgs)                       | 7/7 packages ok                                                                                                        |
| Wallet       | Extension vitest + chain-cosmos                                                                | 1,939 + 47                                                                                                             |
| Frontend     | Cruzible vitest + tsc                                                                          | 309/309, clean                                                                                                         |
| Browser E2E  | three-way spec ×2 fresh deployments, ungated classic spec, 10 hermetic wallet specs            | all passed                                                                                                             |
| Live proofs  | lifecycle, Phase-1, Phase-2 real yield, Phase-2.5 queue loop, identity gate vs real ZeroID.sol | 5/5 passed                                                                                                             |
| **Stress**   | **concurrent storm (below)**                                                                   | **passed**                                                                                                             |
| Dependencies | `npm audit --omit=dev` (cruzible), `pnpm audit --prod` (wallet)                                | 0 vulns / 1 moderate (`uuid` via Expo **mobile build tooling** — not in the shipped extension or any integration path) |

## 3. Stress test (scripts/devnet-stress-test.mjs)

16 independent wallets against a freshly deployed, identity-gated vault on a
live devnet: 12 concurrent ZeroID registrations, 4 storm rounds of
randomized concurrent stake / unstake / instant-exit traffic, a 4-wallet
unregistered control group attacking the gate throughout, and a mid-storm
governance suspension of two identities.

- **99 transactions; zero unauthorized admissions.** All 16 unregistered
  attempts and all 4 post-suspension attempts were blocked; suspended
  wallets kept full exit access.
- **Solvency EXACT to the wei after the storm:**
  `balance == totalPooledAethel + totalReserved + merkleReserve` held with
  18.408845661810273916 AETHEL on both sides.
- **Read path under a 300-call concurrent burst** (the wallet/frontend
  polling surface): p50 46ms · p95 76ms · p99 87ms.
- Throughput measured at 2.7 successful tx/s sustained — **block-rate-bound
  on a single-node devnet**, not a protocol ceiling; a multi-validator
  benchmark is a pre-production item (section 5).

## 4. Adversarial findings (test/CruzibleAdversarial.t.sol)

All confirmed as DEFENDED, each pinned by a permanent test:

1. **Rounding can never favor the staker** — fuzzed stake→unstake
   round-trips at an odd exchange rate never return more than deposited.
2. **Instant exits are exact** — payout is precisely value-minus-fee,
   buffer-bounded, solvency preserved (fuzzed).
3. **The decimal bridge rejects all dust** — any non-whole-uaethel amount
   reverts; every whole multiple delegates (fuzzed over the domain).
4. **A broken/malicious identity registry fails CLOSED for entry and stays
   OPEN for exit** — a reverting registry bricks new stakes only; unstake,
   instant exit, and withdraw all keep working. The identity layer can
   never trap funds.
5. **A misconfigured gate (EOA/wrong address) fails closed, not open** — a
   configuration mistake can never silently admit everyone.

## 5. Blocking items before production for sovereign/regulated clients

None of these are code defects; all are assurance/operations gates, in
priority order:

1. **External Tier-1 security audit** of Cruzible + the ZeroID registry +
   the wallet signing path. Everything above is _self_-audit; this client
   class requires independent assurance (RFP program already exists).
2. **Multi-validator operation** — the running public testnet must activate
   the staking/distribution precompiles (merged, needs binary upgrade +
   param update), and three surfaces need the multi-validator net: the
   seal-quorum path (`stakeWithSeal` E2E, gap W-3), a staged live slashing
   drill, and a realistic throughput benchmark.
3. **Governance hardening at deploy time** — production deployments must
   use a timelock/multisig for governance/rewarder/pauser (the contracts
   support it; test deployments use single keys), with the identity-gate
   registry address under the same control.
4. **ZeroID production gates** — real multi-party ZK ceremony (current
   artifacts use a dev beacon) and the SaaS backend's production
   deployment posture.
5. **Wallet release engineering** — the extension is v0.9.x beta: store
   distribution, update channel, and the wallet's own external audit.
6. **Operational readiness** — monitoring/alerting for the keeper functions
   (`undelegateForQueue`, `syncUndelegations`, `reconcileValidator`),
   incident runbooks per deployment, and key-custody procedures
   (MPC-TSS/Trezor support exists in the wallet; per-client custody policy
   is an onboarding artifact).

## 6. Standing guarantees the integration makes (all test-pinned)

- Identity is checked **live on every stake** — revocation in ZeroID blocks
  the next stake in the same block; nothing is cached.
- **Exits are never gated** by identity, pause, or registry failure.
- Yield is **earned on-chain** (staking precompiles), never operator-typed;
  the push path is rate-guarded and interval-limited.
- Exit liquidity is **permissionless** (deficit-computed undelegation);
  slashing is socialized pro-rata, reconciled against consensus state.
- The wallet shows users **what they are signing** (full first-party intent
  decoding) and **what they own** (live on-chain position, no seeded data).
