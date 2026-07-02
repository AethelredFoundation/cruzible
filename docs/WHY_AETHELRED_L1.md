# Why Cruzible runs on Aethelred (a sovereign L1), not an Ethereum L2

For institutions evaluating Cruzible, and for the developers/auditors reviewing
it: a plain-language version of the chain-level argument in the Aethelred repo's
`docs/architecture/ADR-0004-sovereign-l1-not-l2.md`.

## The one-sentence answer

Cruzible's institutional differentiator — **staking entry gated by an on-chain,
consensus-issued compliance attestation, with no oracle in the trust path** — is
a property of Aethelred's *consensus*, and an Ethereum L2 has no consensus of its
own to put it in.

## What Cruzible does that a "liquid staking dApp on an L2" cannot

When compliance mode is on, a stake is admitted only if the chain's own
validators have minted a **Digital Seal** attesting that a compliance check was
run for that exact staker under a policy the institution set (jurisdiction,
confidentiality backend, production-silicon root). Cruzible reads that seal
through a **precompile** and re-runs the *same consensus logic* that minted it.

On an Ethereum rollup this is impossible without reintroducing a trusted third
party:

| Requirement | Aethelred L1 | Ethereum L2 |
|---|---|---|
| Compliance attestation is issued by the chain's validators | Yes — PoUW quorum in consensus | No — L2 has no validator quorum; it rents Ethereum's |
| dApp reads that attestation with no bridge/oracle | Yes — `ISeal` precompile reads consensus-native state | No — state lives on the L1; needs a bridge/oracle |
| Ordering, data, validators stay in the client's jurisdiction | Yes — sovereign deployment | No — data + ordering go to Ethereum mainnet |
| Finality of the sealed result is post-quantum | Yes — ML-DSA at consensus | No — inherits Ethereum's classical finality |
| Staking yield = the chain's own attested useful work | Yes — PoUW rewards rebase stAETHEL | No — rewards accrue to Ethereum + the sequencer |

Remove the L1 and every row degrades to "trust an off-chain service" — which is
the status quo Cruzible exists to replace.

## For institutions: why this matters for your assets

- **Your compliance rule is enforced by consensus, not by us.** The admission
  decision is made by the same code that finalizes blocks and is auditable on
  chain — you are not trusting a Cruzible server or a KYC vendor's API at the
  moment of staking.
- **Sovereign deployability.** For a consortium or regulated entity, Aethelred
  can run inside your boundary: your validators, your jurisdiction, your data.
  Cruzible runs on top unchanged.
- **EVM where it helps, sovereignty where it counts.** You use the wallets and
  tooling you already have (chain-id 7332, standard JSON-RPC); the trust
  guarantees live at a layer a rollup cannot reach.

## For developers

You build against a standard EVM (Solidity, viem/wagmi, JSON-RPC on 7332). The
difference is the verifiable-AI precompiles (`ISeal` 0x0900, `IVerify` 0x0901,
`IPoUW` 0x0902) that read attested-AI state directly — because Cruzible and those
modules are one state machine, not a dApp bridged to another chain.

## Not "just another L1"

Aethelred's value is the *combination* — attested-compute-as-consensus +
post-quantum finality + confidential-execution attestation + sovereign
deployment + an EVM surface that reads all of it without a bridge — in one state
machine. Cruzible is the first application to make that combination usable:
compliant liquid staking that no chain settling to a public L1 can offer.
