# Historical Audit Evidence Index

> This is a point-in-time snapshot for the 2026-07-11 audit. It does not cover
> later hardening commits and must not be presented as evidence for the current
> release candidate. A new candidate needs machine-readable results pinned to
> its exact commit, chain binary digest, genesis hash, and deployed bytecode.

Immutable identifiers for every result in
[PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md) (rev. 2,
2026-07-11). All commands run from the repo roots at the commits below.

## Commits under audit

| Repo                                     | Branch                                            | Commit                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aethelred-foundation/cruzible`          | `fix/native-staking-and-balance` (PR #11)         | `79e170b7cc52259534871cff695a14cc6afe5aeb`                                                                                                                                   |
| `aethelred-foundation/aethelred` (chain) | `release/public-testnet-pqc` (post-merge PR #154) | `d665afa46dc433b07e4dc2e660d86ada818a10f3` (test runs); vuln remediation merged after as PR #155, merge `3850fb27919a` (Go 1.25.12 toolchain + x/net v0.55.0; retested 7/7 ok) |
| wallet                                   | `feat/dapp-connection-consent` (PR #190)          | `9505d57cb4f979e32b047c83fce8a7f0f8ecd432`                                                                                                                                     |
| zeroid                                   | `feat/economic-flywheel`                          | `672cbe5093b5d1186eafeb4800d991b87d1d68d5`                                                                                                                                     |

## Toolchain

| Tool         | Version / configuration                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| solc         | 0.8.20, optimizer on (200 runs), `--via-ir`, EVM target shanghai (`backend/contracts-evm/build.sh`, pinned check)            |
| forge        | 1.5.1 (fuzz: default 256 runs per fuzz test; seeds foundry-default per run — failure corpus empty, no counterexamples found) |
| Node.js      | v24.8.0                                                                                                                      |
| Go           | 1.25.7                                                                                                                       |
| Chain binary | built from the chain commit above (branch `feat/staking-distribution-precompiles`, identical tree to the release merge)      |

## Chain under test

- Devnet chain-id (Cosmos): `aethelred-devnet-1`; EVM chain-id **7332**
  (`0x1ca4`); single validator; `unbonding_time` = 60s (genesis override,
  documented in the scripts); JSON-RPC `127.0.0.1:8547`;
  `AETHELRED_TEE_MODE=simulated` (dev-only flag, PQC hybrid signing on).
- Artifact bytecode (sha256 of the committed hex artifacts):
  `Cruzible.bin 1a860e59ebe198e92c95fc988412334ce2e40d787adfd0047e9848a70086c169`,
  `StAETHEL.bin 74ee09133cf8f84a5d47daec69feed53be3df491095b9b2ee3c321f1984d3677`
  (post Model-B; earlier runs used the pre-Model-B StAETHEL,
  `c335b4d1f5d6b510fc6fb781d64b35432404543765b91694a39534f2085049d1`).
- Deployments are fresh per script run; each script prints its addresses and
  constructor args (governance/rewarder/pauser = deployer key on devnet;
  vault unbonding 30s for E2E, 3600s default in `deploy-contracts.mjs`).

## Commands (reproduce any row of the evidence table)

```bash
# Contracts at the pinned audit commit — 59 tests incl. fuzz/adversarial/economic/identity-boundary
cd backend/contracts-evm && forge test

# Chain — post-merge release branch
go test ./app/... ./precompiles/...

# Wallet
cd apps/extension && npx vitest run          # 1,939
npx vitest run --config vitest.chain-cosmos.config.mts   # 47

# Cruzible frontend
npx tsc --noEmit && npx vitest run           # 309

# Hermetic wallet browser suite
cd apps/extension && npx playwright test --config e2e/playwright.config.ts

# Live proofs (devnet running; env per script header)
node scripts/devnet-deploy-e2e.mjs
node scripts/devnet-phase1-e2e.mjs
node scripts/devnet-phase2-e2e.mjs
node scripts/devnet-phase25-e2e.mjs
node scripts/devnet-identity-gate-e2e.mjs

# Three-way browser E2E (setup prints all env)
node scripts/setup-three-way-e2e.mjs
THREE_WAY_INTEGRATION=1 npx playwright test three-way-integration

# Concurrent functional load test
node scripts/devnet-stress-test.mjs          # WALLETS=16 ROUNDS=4 defaults

# Dependency point-in-time checks
npm audit --omit=dev            # cruzible
pnpm audit --prod               # wallet
govulncheck ./...               # chain
```

## Known gaps in this index (to close before external due diligence)

- Branch-protection/reviewer configuration export, signed release tags, and
  SBOM/provenance attestations (Gate 9 in PRODUCTION_GATES.md).
- Machine-readable timestamped result logs archived per run (currently
  reproduced on demand; CI archival is a Gate 9 item).
- Genesis hash and node binary digest per devnet instance (devnets are
  ephemeral; the public-testnet RC will pin these).
