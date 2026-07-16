# Identity Policy — the Identity-Control Boundary

**Status:** decided 2026-07-11 · **Applies to:** Cruzible vault + stAETHEL /
wstAETHEL receipt tokens, gated by the ZeroID registry
**Every statement below is pinned by a test** in
`backend/contracts-evm/test/CruzibleAdversarial.t.sol` (identity-boundary
section).

## The question

"Identity-gated liquid staking" is ambiguous until it says WHO must be
verified: the party who **stakes**, or every party who **holds** the receipt
token. This document makes that decision explicit per deployment model, so
marketing, compliance descriptions, and client contracts can say exactly what
the chain enforces — no more and no less.

## Model A — identity-gated primary issuance (DEFAULT)

`Cruzible.setIdentityGate(registry, true)` with the stAETHEL transfer gate
**off** (its default).

- Staking (minting) requires a registered, ACTIVE ZeroID identity, checked
  live on every stake.
- **stAETHEL and wstAETHEL are freely transferable ERC-20s.** An unverified
  address CAN acquire them on the secondary market (transfer, `transferFrom`,
  DEX, OTC, bridge). It cannot stake more, and — under this model — it can
  redeem what it holds (exits are never identity-gated).
- What ZeroID establishes here: **who interacts with the vault**, not who
  ultimately owns the liquid token. Client-facing language must say
  "identity-verified staking", not "identity-verified ownership".

Pinned by `test_modelA_default_receipt_token_transfers_freely`.

## Model B — identity-gated ownership (OPT-IN)

Model A **plus** `StAETHEL.setTransferGate(true)` (vault-governance only).

- Transfer **recipients** must pass the vault's identity check
  (`isIdentityVerified`), on `transfer` and `transferFrom` alike. Unverified
  parties cannot ACQUIRE stAETHEL.
- **Senders are deliberately never checked**, and mint/burn (stake/unstake/
  instant exit/withdraw) never route through transfers — so a suspended or
  revoked holder can ALWAYS exit. The gate restricts acquisition, never
  departure. Pinned by `test_modelB_suspended_holder_can_always_exit`.
- **The wrapper**: `setTransferAllowlist(wstAETHEL, true)` permits wrapping;
  unwrap transfers to end users remain recipient-checked, so the wrapper
  cannot hand stAETHEL to an unverified party
  (`test_modelB_wrapper_allowlist_and_unwrap_gating`). **Honest residual:**
  wstAETHEL itself remains a freely transferable ERC-20 — an unverified party
  can hold wstAETHEL (value exposure) but can never unwrap it to stAETHEL or
  reach the vault. Deployments that cannot accept even that exposure must NOT
  allowlist the wrapper (wrapping disabled) and must not list the token
  externally.
- Known accepted boundaries (disclose to clients): a verified smart contract
  or omnibus custodial wallet may have multiple beneficial owners behind it;
  a verified account can be lent or delegated. On-chain address verification
  cannot see behind an address — beneficial-owner obligations in such setups
  belong to the account holder (see Model C).

## Model C — custodian-held (CONTRACTUAL, on top of A or B)

Identity attaches to an institution (custodian/omnibus account) rather than
end users. The chain enforces Model A or B against the custodian's addresses;
beneficial-owner KYC, sub-account controls, and legal holds live in the
custodian's own control framework. This is a legal/contractual model, not an
additional contract feature — the client deployment profile must state it.

## Exit freedom vs. legal holds — the explicit position

The base protocol **cannot freeze withdrawals**. This is a deliberate,
test-pinned property (`exits are never identity-gated`, `withdrawals never
pausable`), and it is a safety feature: no registry failure, governance
mistake, or compromised key can trap client funds.

Deployments that legally require sanctions freezes or court-ordered holds
must implement them **outside the base vault** — via a custodian-controlled
wrapper (Model C) or a separately governed, narrowly scoped hold layer that a
client explicitly contracts for. We do not weaken the base guarantee
silently, and any hold layer must be separately auditable, time-bound where
possible, and incapable of general-purpose fund seizure.

## Deployment checklist

| Deployment claim              | Required configuration                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| "Identity-verified staking"   | Model A: vault gate on                                                                                                                         |
| "Identity-verified ownership" | Model B: vault gate on + transfer gate on; decide the wrapper (allowlist = wrapping with the residual above; no allowlist = wrapping disabled) |
| "Custodial / omnibus"         | Model A or B against custodian addresses + Model C contractual controls                                                                        |
| Any legal-hold requirement    | Out-of-vault hold layer, separately contracted and governed                                                                                    |
