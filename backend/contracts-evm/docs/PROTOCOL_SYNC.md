# Cruzible ↔ Aethelred protocol synchronization

How the Cruzible liquid-staking contracts stay in lock-step with the Aethelred
L1 protocol — the pieces that make Cruzible *of* Aethelred, not merely deployed
on it.

## 1. Native token, exact-value bridge

Cruzible stakes **native AETHEL** (no wrapped ERC-20 in the trust path — one
fewer depeg/approval surface). The EVM presents AETHEL as 18-decimal `aaethel`;
the chain's bank denom is 6-decimal `uaethel`, reconciled by the chain's
`x/precisebank` module at a fixed 1e12 factor. Cruzible therefore sees exact
wei-scale balances and never truncates value on the Cosmos side. (Chain repo:
`app/evmconfig`, ADR-0001.)

## 2. Yield source: the chain's useful work is the staking yield

stAETHEL rebases when the **rewarder** calls `addRewards{value:…}()`. The
rewarder is the chain's reward-treasury account, and the flow is:

```
PoUW verification / validator commission rewards
   → reward-treasury account (the rewarder role)
   → Cruzible.addRewards()  → totalPooledAethel += amount
   → every stAETHEL balance rebases up (rate = pooled / shares)
```

So the yield is produced by the same attested useful work (AI verification) that
secures the chain — not by inflation or by staking someone else's security. APY
is **computed** by the contract from on-chain epoch rate-checkpoints
(`advanceEpoch` → `effectiveAPY`), never operator-typed.

Status: the routing is **operational** (a treasury/keeper transaction), not an
in-contract autonomous stream. This keeps the vault immutable and auditable; the
treasury policy (how much PoUW reward routes to Cruzible) lives in chain
governance, not in the vault bytecode.

## 3. Compliance gate: consensus-native attestation, no oracle

`stakeWithSeal(jobId)` reads a **Digital Seal** through the `ISeal` precompile
(0x0900). The seal is minted by the chain's PoUW pipeline: a compliance job is
submitted with `--purpose cruzible-stake:0x<staker>` and a confidentiality
policy (`--conf-backends`, `--conf-residency`, …); validators verify it and a
≥⅔ quorum mints the seal, binding the purpose and the
`ConfidentialityAttestation`. Cruzible's admission check
(`requireConfidentiality`) runs the **same** `internal/confidential.Satisfies`
the chain ran at sealing — consensus parity, no bridge.

This is the operator flow the `scripts/devnet-seal-gate-e2e.mjs` playbook prints:

```
aethelredd tx pouw submit-job \
  --model cruzible-kyc-v1 --input applicant-0x<staker> \
  --proof-type tee --purpose "cruzible-stake:0x<staker>" \
  --conf-backends fhe --conf-residency EU --from validator --yes
# → wait for the quorum-minted seal, then stakeWithSeal(jobId)
```

## 4. Address & identity model

An Aethelred account has both a 0x (EVM) and a bech32 (`aethel1…`) form over the
same key bytes. The wallet and Cruzible operate on the 0x form; the PoUW job's
purpose binds the 0x form; funding/native ops use the bech32 form. The
`devnet-*` scripts show the exact correspondence.

## 5. Version pinning

- EVM chain-id: **7332** (the chain's in-state EIP-155 id; `eth_chainId` →
  `0x1ca4`). Cruzible's `src/config/chains.ts` and the deploy scripts pin it.
- Contracts: solc **0.8.20**, `--via-ir`, optimizer 200, target shanghai —
  identical to the chain repo's reference-contract build, so artifacts are
  reproducible and cross-repo-verifiable.
- The `ISeal` interface Cruzible imports is copied from the chain repo's
  canonical `precompiles/seal/ISeal.sol`; the precompile ABI is a chain-consensus
  contract, versioned with the chain.

## Sync checklist when the chain changes

- Chain EVM id changes → update `chains.ts` + deploy scripts + `foundry.toml`
  chain assumptions.
- `ISeal` ABI changes → re-copy `src/interfaces/ISeal.sol`, rebuild, re-run the
  chain-repo `evmhost` integration test.
- CEAP policy vocabulary changes (backends/verification names) → update
  governance `setCompliancePolicy` calls; the on-chain `Satisfies` remains the
  single source of truth.
