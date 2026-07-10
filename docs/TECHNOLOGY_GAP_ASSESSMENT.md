# Cruzible × Aethelred Wallet — Technology Gap Assessment

**Date:** 2026-07-10 · **Benchmark:** Lido, Rocket Pool, Jito, Ankr (the liquid-staking incumbent bar)
**Ground rules:** every gap below is grounded in verified code facts (file references), not impressions. Gaps are stated honestly — including the ones we cannot close from this repo.

## Where Cruzible is already ahead

| Capability | Cruzible | Incumbents |
|---|---|---|
| Compliance-gated admission | `stakeWithSeal` verifies a consensus-minted Digital Seal via the ISeal precompile (purpose-bound to the staker, live revocation, CEAP policy) | None — no incumbent can gate staking on chain-verified compliance |
| Truth-first UI | Vault hero renders only live contract-backed TVL/rate/APY; synthetic overlays hidden until proofs exist | Widely mixed; several render projected/indexed values as live |
| Withdrawal queue integrity | Withdrawals never pausable (tested), two-step governance, per-user queue with on-chain ids | Comparable at the top end (Lido v2 withdrawals) |
| Wallet trust surface | Per-origin consent, policy engine with spending context, fail-closed pricing, EIP-191/1193 correctness — all guard-tested | MetaMask-class wallets are permissive by comparison |

The moat is real. The gaps below are what a diligent LP or integrator would find behind it.

## Gap table (verified)

### Protocol layer

| # | Gap | Evidence | Incumbent bar | Phase |
|---|---|---|---|---|
| P-1 | **Yield is governance-pushed, not earned.** `addRewards()` is a payable rewarder call; pooled AETHEL sits undelegated in the vault | `Cruzible.sol:397` | Lido stakes on the consensus layer; oracles report earned rewards | **P2 — requires chain work: the EVM activates only ISeal/IVerify/IPoUW precompiles (`app/evmconfig/evmconfig.go:56`); cosmos/evm's staking (0x800) & distribution (0x801) precompiles exist upstream but are not registered.** Activating them lets the vault delegate pooled AETHEL and earn real x/staking rewards — the single highest-impact item in this document |
| P-2 | **No slashing accounting.** A validator slashing event has no representation in vault accounting | absent from `Cruzible.sol`; UI discloses it | Lido socializes slashing across the pool | P2 (depends on P-1 delegation) |
| P-3 | **Rewarder is a single key.** Reward reporting has no quorum | `onlyRewarder` | Lido: oracle committee with quorum + sanity bounds | P3 (oracle committee); P1 adds the sanity bounds now |

### Contract layer

| # | Gap | Evidence | Incumbent bar | Phase |
|---|---|---|---|---|
| C-1 | **Unbounded rate manipulation by one key.** `addRewards` accepts any value at any frequency — a compromised/typoing rewarder key can move the exchange rate arbitrarily in one tx | `Cruzible.sol:397-401` | Lido caps oracle report deltas (annual-limit sanity checks) | **P1 (this pass)** |
| C-2 | **No instant exit.** Only the unbonding queue (21d prod); the UI honestly says secondary-market exit is out of scope | `unstake/withdraw` only | Instant exit via protocol buffer/liquidity with fee is table stakes | **P1 (this pass)** |
| C-3 | **No non-rebasing wrapper.** Rebasing stAETHEL breaks AMMs, lending markets, and vault integrations | only `StAETHEL.sol` (rebasing) | wstETH pattern; ERC-4626-style accounting | **P1 (this pass)** |
| C-4 | **No gasless approvals.** No EIP-2612 permit anywhere | `StAETHEL.sol` | Standard across incumbents | **P1 (on the wrapper)** |
| C-5 | External audit + slashing drills | disclosed in UI | All incumbents are multi-audited | Ongoing (RFP program exists) |

### Wallet-integration layer

| # | Gap | Evidence | Incumbent bar | Phase |
|---|---|---|---|---|
| W-1 | Approval sheet shows raw calldata for vault methods — no human decoding of stake/unstake intent | wallet `handleSendTransaction` decode path lacks Cruzible ABI | Rabby-class wallets decode intent + simulate outcome | P2 |
| W-2 | No staked-position card in the wallet portfolio (stAETHEL balance, pending withdrawals, claimables) | portfolio reads token balances only | Native staking views in top wallets | P2 |
| W-3 | Seal-gated admission E2E needs the multi-validator seal pipeline | single-node devnet cannot mint a quorum seal (mapped 2026-07-10) | n/a (moat feature) | Chain team |

## Phase 1 — shipped in this pass

1. **Rate-safety guard (C-1):** `addRewards` bounded by `maxRebaseBps` per report (default 5%, hard cap 20%) and `minRewardInterval` (default 1h, floor 10min). Governance can tune within bounds but can no longer move the rate arbitrarily in one transaction — the guard binds governance too.
2. **Instant unstake (C-2):** `instantUnstake(shares, minOut)` pays immediately from the vault's free buffer (balance − reserved − merkle reserve) minus `instantExitFeeBps` (default 0.5%, hard cap 2%). The fee stays in the pool, rebasing every remaining holder upward. Clear revert when the buffer cannot cover; the queue path is untouched.
3. **WstAETHEL (C-3/C-4):** non-rebasing wrapper over stAETHEL (wstETH pattern — wrap locks stAETHEL, mints fixed-balance wstAETHEL equal to the share count; value accrues via the redemption rate), full ERC-20 plus EIP-2612 permit, dependency-free to match house style.

All Phase-1 items land with Foundry coverage and a live devnet end-to-end proof.

## Phase 2 — the real yield engine — **PLUMBING LANDED (2026-07-11)**

The core loop is live and proven end-to-end on a devnet (`scripts/devnet-phase2-e2e.mjs`):

- **Chain**: cosmos/evm's staking (0x0800) and distribution (0x0801) precompiles are activated (`feat/staking-distribution-precompiles`); `delegation()` via `eth_call` reads real x/staking state.
- **Vault**: `delegateToValidator` moves pooled AETHEL into x/staking through the precompile (native balance drops — the free buffer and instant-exit path honestly reflect it), `claimStakingRewards` (permissionless) folds EARNED block rewards into `totalPooledAethel` — the exchange rate rises with zero `addRewards` calls. Amounts convert across the 6↔18-decimal bridge with dust rejected.

**Honest remaining scope before calling P-1 closed:** delegation is governance-operated during the rollout (no automatic per-stake delegation policy yet); the withdrawal queue is not yet fed by real undelegations automatically (`undelegateFromValidator` exists; funds return to the vault after chain unbonding, but queue-matching is operational); P-2 slashing accounting is still open; multi-validator allocation strategy is still open. These are the Phase-2.5 work items.

## Phase 3 — depth

Oracle committee for reward reporting (P-3), DEX liquidity for wstAETHEL, wallet position card + approval decoding (W-1/W-2), external audit + staged slashing drills (C-5).
