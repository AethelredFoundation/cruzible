# Cruzible — Testnet Deployment Guide

End-to-end setup of the Cruzible stack against an Aethelred network (chain id
**7332**): contracts → frontend → optional backend API. Written for the public
testnet (`http://54.165.44.130:8545`); the same steps work against any 7332
endpoint, including a local devnet.

> **Contracts are Solidity on the Aethelred EVM** (`backend/contracts-evm`).
> The CosmWasm workspace in `backend/contracts` is the earlier Cosmos-native
> track and is NOT what gets deployed. Unlike ZeroID there is no Foundry
> broadcast script — the contracts build hermetically with pinned solc and
> deploy from committed artifacts via a Node script (the repo's house style;
> the same path every live proof in `scripts/devnet-*.mjs` uses).

## 1. Prerequisites

- Node.js 20+ and `npm ci` run at the repo root (the deploy script uses the
  repo's own `viem`).
- A **funded deployer key** on the target network. AETHEL is the NATIVE coin
  (6-decimal `uaethel` bridged 1e12 → 18-decimal EVM units). To fund a fresh
  EVM address from a validator box:

  ```bash
  # bech32 form of the 0x address (drop the 0x prefix):
  aethelredd debug addr <hex-address-without-0x>
  # then send from a funded key (30 AETHEL covers deployment many times over):
  aethelredd tx bank send validator <aethel1...> 30000000uaethel \
    --chain-id <cosmos-chain-id> --keyring-backend test --fees 2000uaethel -y
  ```

  The balance appears on the EVM face (`eth_getBalance`) after ~1 block.

## 2. Deploy the contracts

```bash
RPC_URL=http://54.165.44.130:8545 \
DEPLOYER_KEY=0x<funded-private-key> \
node scripts/deploy-contracts.mjs
```

This deploys **Cruzible** (vault), **StAETHEL** (rebasing receipt token),
**WstAETHEL** (non-rebasing wrapper), wires the vault↔token link, runs sanity
checks (chain id, wiring, exchange rate exactly 1.0), and prints the env lines
for steps 3 and 4 ready to paste.

Optional env:

| Variable                   | Default   | Purpose                                                                                                                                                                                                                                                                     |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOVERNANCE`               | deployer  | Nominates a separate governance address (two-step: it must call `acceptGovernance()`; deployer keeps control until then)                                                                                                                                                    |
| `REWARDER`, `PAUSER`       | deployer  | Role separation at deploy time                                                                                                                                                                                                                                              |
| `UNBONDING_PERIOD_SECONDS` | `3600`    | Withdrawal-queue delay. 1h is right for testing; set `1814400` (21d) once delegation to validators is live so the vault queue mirrors the chain's unbonding period                                                                                                          |
| `SKIP_WSTAETHEL=1`         | unset     | Skip the wrapper                                                                                                                                                                                                                                                            |
| `ZEROID_REGISTRY=0x...`    | unset     | Turn the **ZeroID identity gate** on: staking then requires a registered, ACTIVE ZeroID identity for the staker (checked live — revocation in ZeroID blocks new stakes instantly; exits are never gated). Point at the ZeroID registry already deployed on the same network |
| `OUT=<path>`               | unset     | Write the validated EVM deployment evidence manifest (required with `RELEASE_DEPLOYMENT=1`)                                                                                                                                                                                 |
| `DEPLOYMENT_ENV`           | `testnet` | Evidence label; only `devnet` and `testnet` are accepted because this repository has no confirmed mainnet defaults                                                                                                                                                          |
| `RELEASE_DEPLOYMENT=1`     | unset     | Require `OUT` and a clean tracked worktree before broadcasting                                                                                                                                                                                                              |

With `RELEASE_DEPLOYMENT=1`, the deployer also runs the pinned Forge build and
rejects any Solidity/source artifact drift before it broadcasts. If
`ZEROID_REGISTRY` is set, preflight requires deployed bytecode and successful
`resolveByController(address)` and `isActiveIdentity(bytes32)` probes; a random
contract address cannot silently enable the identity gate.

Notes vs the ZeroID forge flags: gas is estimated per-tx and sent with **2×
headroom** (the `--gas-estimate-multiplier 200` equivalent — harmless on nodes
with the fixed `eth_estimateGas`, load-bearing on older ones), and receipts
are awaited sequentially (`--slow` equivalent). No `--legacy` needed — viem
negotiates the fee format.

Rebuilding artifacts is only needed if you **change contract sources**:
`backend/contracts-evm/build.sh` (pinned solc 0.8.20; the committed artifacts
in `backend/contracts-evm/artifacts/` are reproducible and deploy-ready).
`npm run contracts:evm:check` rejects source/artifact drift before release.

The `OUT` manifest records the exact source commit and clean/dirty state,
redacted RPC origin, chain ID, canonical EVM genesis anchor block 1 and
evidence-head hashes, every deploy
transaction/block/gas value, ABI and creation/runtime bytecode SHA-256 hashes,
wiring transactions, and the on-chain current/pending governance state. Validate
an archived file with `npm run deployment:evm:validate -- <manifest.json>`.
RPC credentials, query tokens, and provider paths are deliberately omitted.

## 3. Frontend

```bash
cp .env.example .env.local
```

Set in `.env.local` (all `NEXT_PUBLIC_*` values are inlined at **build time**
— set them before `npm run build`, and restart `npm run dev` after edits):

```bash
NEXT_PUBLIC_CHAIN_ENV=testnet
NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL=<operator-approved EVM JSON-RPC URL>
NEXT_PUBLIC_AETHELRED_GENESIS_HASH=0xf4b43647f4d3255a7e9321ea4b32057101ed143623390bc30d59e69a91ceafa7
NEXT_PUBLIC_API_URL=<deployed Cruzible API URL>
# from the deploy script output:
NEXT_PUBLIC_CRUZIBLE_ADDRESS=0x...
NEXT_PUBLIC_STAETHEL_ADDRESS=0x...
```

The current public-testnet Cruzible deployment must be replaced before this
release is presented for retest. The bounded stake/unstake selectors, withdrawal
event deadline, and share-accounting behavior are part of the new bytecode; a
frontend built from this source must not point at the previous vault. Archive
the clean `OUT` manifest from the replacement deployment, then set its JSON as
`RELEASE_EVM_DEPLOYMENT_MANIFEST_JSON` when building/releasing. Run
`npm run deployment:evm:release-validate` with the same frontend network and
contract environment variables. It checks live canonical EVM anchor block 1,
deploy transaction
initcode and receipts, runtime bytecode, vault/token wiring, and current
source/artifact hashes, and fails closed for a stale deployment.

Do **not** set `NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS` — AETHEL is the native coin
on Aethelred; that variable exists only for chains with a bridged ERC-20.
`NEXT_PUBLIC_API_URL` may be omitted only for `npm run dev` during local,
contract-only vault work; reconciliation and validator-intelligence then show
"not yet available." It is required by the fail-closed `npm run build` contract
and every complete testnet/production image. Configure the API in step 4 before
building the image the US team will retest.

```bash
npm ci
npm run dev          # or: npm run build && npm run start
```

Wallet: add the network to the Aethelred Wallet (or MetaMask) with RPC
`http://54.165.44.130:8545`, chain id `7332`, currency `AETHEL`.

## 4. Backend API (optional)

`backend/api` is the Express/TypeScript control-plane (reconciliation,
validator intelligence, ops/auth). It reads **process env only** (no `.env`
auto-loading) — inject via your shell/process manager/compose. Full variable
reference: [backend/.env.example](../backend/.env.example) and
[docs/ops/environment-reference.md](ops/environment-reference.md).

Minimum viable set (needs reachable PostgreSQL + Redis):

```bash
export NODE_ENV=development
export PORT=3001
export DATABASE_URL=postgresql://user:pass@localhost:5432/cruzible
export REDIS_URL=redis://localhost:6379
export RPC_URL=http://54.165.44.130:8545
export JWT_SECRET=<random-32+chars>          # openssl rand -hex 32
export JWT_REFRESH_SECRET=<random-32+chars>
# from the deploy script output:
export CRUZIBLE_VAULT_ADDRESS=0x...
export STAETHEL_ADDRESS=0x...
# indexer (event ingestion) — point at the same node's RPC/WS:
export INDEXER_RPC_URL=http://54.165.44.130:8545
export INDEXER_WS_URL=ws://54.165.44.130:8546
export INDEXER_EXPECTED_CHAIN_ID=7332
export INDEXER_EXPECTED_GENESIS_HASH=0xf4b43647f4d3255a7e9321ea4b32057101ed143623390bc30d59e69a91ceafa7

cd backend/api
npm ci
npm run db:migrate:deploy
npm run dev            # or: npm run build && npm run start
```

Then set `NEXT_PUBLIC_API_URL=<browser-reachable API URL>` in the frontend env
and rebuild. `localhost` is valid only for a `devnet` build; testnet API origins
must match the approved or explicitly operator-allowlisted build origin.
Production hardening (secrets via `*_FILE`, operational-endpoint
token, operator/admin wallet allowlists, compose/K8s) is covered in
[docs/ops/runbook.md](ops/runbook.md).

## 5. Verify the deployment

Quick on-chain check that the vault is alive (rate is 1e18 on a fresh vault):

```bash
curl -s -X POST -H 'Content-Type: application/json' --data '{
  "jsonrpc":"2.0","id":1,"method":"eth_call",
  "params":[{"to":"<CRUZIBLE_ADDRESS>","data":"0xe6aa216c"},"latest"]
}' http://54.165.44.130:8545   # getExchangeRate() selector
```

Full lifecycle proof (deploys its OWN throwaway instance, then stakes,
rebases, unstakes, withdraws — safe to run against any endpoint):

```bash
RPC_URL=http://54.165.44.130:8545 DEPLOYER_KEY=0x<funded-key> \
  node scripts/devnet-deploy-e2e.mjs
```

## 6. Feature availability on the current public testnet

Honest status — the vault has two tiers of functionality:

| Works today                                                                                                                                                                       | Requires the chain upgrade below                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| stake / stakeWithReferral, unstake + withdrawal queue, instant unstake, wstAETHEL wrap/unwrap + permit, addRewards (rate-guarded), Merkle rewards, computed APY, pause/governance | `delegateToValidator`, `claimStakingRewards` (real yield), `undelegateForQueue`, `syncUndelegations`, `reconcileValidator` (slashing) |

The right column needs the **staking (0x0800) and distribution (0x0801)
precompiles**, merged into `release/public-testnet-pqc` via chain PR #154 but
not yet active on the running public testnet: `ActiveStaticPrecompiles` is an
x/vm **state param**, so the network picks them up only after validators
upgrade binaries **and** either a re-genesis or a governance
`MsgUpdateParams` adds the two addresses. Until then those functions revert —
the UI's staking flows are unaffected. Both tiers are fully proven on a
devnet built from the merged branch (`scripts/devnet-phase2-e2e.mjs`,
`scripts/devnet-phase25-e2e.mjs`).

`stakeWithSeal` (compliance-gated entry) additionally needs the PoUW seal
pipeline with a multi-validator quorum — see
[docs/ops/runbook.md](ops/runbook.md) and the chain repo's validator
onboarding docs.

## 7. Troubleshooting

- **`deployer has no AETHEL for gas`** — fund the key (step 1); remember the
  balance shows on the EVM face only after a block.
- **`connected chain id X, want 7332`** — the RPC endpoint is not an Aethelred
  EVM JSON-RPC (node must run with `--json-rpc.enable`).
- **`DelegationFailed` / reverts on delegate/claim/reconcile** — the target
  network doesn't have the 0x0800/0x0801 precompiles active yet (section 6).
- **Frontend shows zero balances / wrong network** — `NEXT_PUBLIC_*` values
  are compiled in at build time; re-run `npm run build` (or restart the dev
  server) after changing `.env.local`.
- **Wallet gas estimation fails against a non-default port** — upgrade to a
  wallet build ≥ the loopback-CSP fix if testing against local nodes on
  custom ports.
