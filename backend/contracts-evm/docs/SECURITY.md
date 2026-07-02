# Cruzible EVM contracts — security & production model

Scope: `Cruzible.sol` (liquid-staking vault) and `StAETHEL.sol` (rebasing
receipt token) on the Aethelred EVM (chain-id 7332). This document is the
entry point for an external review (Trail of Bits / OpenZeppelin / Spearbit
class) and for regulated-client due diligence. Every control below is enforced
in code and covered by a test in `test/Cruzible.t.sol` (Foundry) and by the
real-precompile integration test in the Aethelred repo
(`internal/evmhost/cruzible_test.go`).

## Design stance: immutable core + governed parameters

The contracts are **immutable** (no proxy, no upgrade delegatecall). Regulated
clients can audit the deployed bytecode once and know it will not change under
them. Behaviour is adjusted only through a bounded set of governance-gated
**parameters** (compliance policy, unbonding period, roles) — never code.

- **Governance is expected to be a timelock (and/or multisig).** The contracts
  check `msg.sender == governance`; the timelock is the governance address, the
  industry-standard pattern (Aave/Lido/Compound). This gives stakers advance
  visibility of sensitive changes and time to exit before they take effect.
- **Two-step governance transfer** (`transferGovernance` → `acceptGovernance`)
  prevents an unrecoverable hand-off to a wrong or unowned address.

## Roles (least privilege)

| Role | Can | Cannot |
|---|---|---|
| governance | set compliance policy/mode, unbonding period, rotate roles (two-step) | move user funds, mint/burn shares, pause withdrawals |
| rewarder | `addRewards` (rebase), `fundRewardsProgram`, `advanceEpoch`, post Merkle roots | change policy, touch principal, pause |
| pauser | pause **deposits** only | pause withdrawals, move funds |

Withdrawals are **never** pausable — a client can always exit
(`test_withdrawals_never_pausable`).

## Invariants (enforced + tested)

1. **Solvency:** `address(this).balance == totalPooledAethel + totalReserved +
   merkleReserve`. Every native inflow increments exactly one accumulator and
   every outflow decrements the matching one
   (`test_solvency_invariant_holds_across_lifecycle`).
2. **Reward segregation:** Merkle reward claims draw only from `merkleReserve`;
   staked principal and the withdrawal queue are unreachable by a rewards claim.
3. **Queue integrity:** an unstake fixes and *reserves* the AETHEL value at
   request time (`totalReserved`), so a later rate move cannot dilute a queued
   exit and a queued exit cannot dilute remaining stakers.
4. **Share/AETHEL rounding always favours the pool:** shares-on-stake and
   AETHEL-on-unstake both round down, so the protocol never over-issues.

## Attack surface & mitigations

- **First-depositor / share-inflation (the classic vault attack):**
  - The exchange rate reads the explicit `totalPooledAethel` accumulator, never
    `address(this).balance`, so a force-sent (`selfdestruct`/coinbase) donation
    cannot move the rate — donation-inflation is dead by construction.
  - The remaining vector (rewards accruing before a dust deposit rounding its
    shares to 0) is closed by a `MINIMUM_LIQUIDITY = 1000` **dead-shares lock**
    on the first stake (Uniswap-V2 / OZ-ERC4626 pattern) plus a
    `shares > 0` guard on every stake
    (`test_inflation_attack_cannot_zero_out_victim`, `test_dust_bootstrap_reverts`,
    `test_bootstrap_locks_dead_shares`).
- **Reentrancy:** explicit `nonReentrant` guard on every state-changing path;
  native transfers use checks-effects-interactions (effects — `claimed = true`,
  `totalReserved -=` — before the external `call`).
- **Rewards Merkle claims:** per-(epoch, account) replay flag; proof verified
  on-chain; amount bounded by the segregated reserve.
- **Compliance-seal replay:** each seal admits exactly one staker
  (`sealUsed[sealId]`), and admission requires the seal's PoUW-job purpose to
  bind that exact staker address (`test_compliance_gate_*`).

## The compliance gate (why it needs Aethelred L1)

With compliance mode on, `stakeWithSeal(jobId)` admits a staker only if a Digital
Seal exists that is ACTIVE, was minted by a PoUW job whose purpose binds this
staker (`cruzible-stake:0x<addr>`), and whose confidentiality attestation
satisfies the governance-set CEAP policy — evaluated by the **ISeal precompile at
0x0900**, i.e. the same consensus logic that minted the seal. No allowlist
oracle, no off-chain KYC server in the trust path. This is not reproducible on an
Ethereum L2 without a bridge/oracle (see `WHY_AETHELRED_L1.md`).

## Test evidence

- `forge test` — 14/14: lifecycle, pro-rata rewards, access control, solvency
  invariant, share-inflation defense, two-step governance, unpausable
  withdrawals, and the full compliance gate (admit / purpose-reject /
  policy-reject / replay-reject) via a mock ISeal.
- Aethelred `internal/evmhost/cruzible_test.go` — the compiled bytecode against
  the **real** ISeal precompile + a real seal keeper.
- `scripts/devnet-deploy-e2e.mjs` / `devnet-seal-gate-e2e.mjs` — live viem
  proofs against a running node.

## Known limitations / not-yet-done (honest ledger for procurement)

- **External audit pending.** These contracts have not yet been through a Tier-1
  external audit; the controls above are internal-review + test grade. An audit
  is a launch gate.
- **Reward routing is operational, not autonomous.** `addRewards` is called by
  the rewarder (the chain's reward-treasury account); the PoUW→treasury→rebase
  path is wired operationally, not by an in-contract automatic stream (see
  `PROTOCOL_SYNC.md`).
- **Governance timelock is a deployment artifact.** The contracts assume
  governance is a timelock/multisig; that contract is chosen and deployed at
  launch, not embedded here.
- **Formal verification / economic audit** of the rebasing math beyond the
  invariant tests is future work.
