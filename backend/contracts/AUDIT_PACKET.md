# Contract Audit Packet

## Status

The `backend/contracts` workspace is an audit-candidate package. It is not a
mainnet approval. Production readiness still depends on external audit,
staging deployment, final chain parameters, and operator sign-off.

## Scope

The audit-candidate scope includes:

| Contract           | Crate            | Release artifact      |
| ------------------ | ---------------- | --------------------- |
| Vault              | `aethel-vault`   | `aethel_vault.wasm`   |
| AI job manager     | `ai-job-manager` | `ai_job_manager.wasm` |
| CW20 staking token | `cw20-staking`   | `cw20_staking.wasm`   |
| Governance         | `governance`     | `governance.wasm`     |
| Model registry     | `model-registry` | `model_registry.wasm` |
| Seal manager       | `seal-manager`   | `seal_manager.wasm`   |

Out of scope for this packet:

- Frontend transaction builders and wallet UX.
- Backend API deployment and database migrations.
- Chain genesis, validator operations, relayers, and RPC providers.
- Third-party external audit findings not yet received.

## Reproducible Local Commands

Run from `backend/contracts`:

```bash
cargo fmt --all -- --check
cargo check --workspace --all-targets --locked
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
cargo audit
cargo build --workspace --release --target wasm32-unknown-unknown --locked
```

Create local artifact checksums:

```bash
bash scripts/prepare-audit-artifacts.sh
```

The script copies wasm files into `audit-artifacts/contracts`, writes
`SHA256SUMS`, and creates `manifest.json` with the commit, timestamp, file
sizes, and checksums. The CI `Contracts` job performs the same wasm build and
uploads that directory as an audit artifact named with the commit SHA.

## Deployment Assumptions

- The CW20 staking token is instantiated with the vault contract as minter.
- The vault `staking_token` config points to the deployed CW20 staking token.
- Vault unstake uses the staking token `BurnFrom` flow, so users must approve
  the vault before unstaking.
- Operator, pauser, verifier, feeder, and admin roles are controlled by
  production key management outside this repository.
- Governance total-bonded feeder submissions must be sourced from trusted
  staking-module observations until decentralized feeder election is deployed.
- Seal creation depends on the configured AI job manager address returning
  canonical job state.
- Model registry job-count updates depend on the configured AI job manager
  address after deployment.
- Contract instantiation, migration, and address wiring must be recorded in a
  release manifest before any production deployment.

## Known Residual Review Items

These are not hidden TODOs. They are explicit pre-production review items:

| Item                               | Status | Required action                                                                        |
| ---------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| External audit                     | Open   | Complete independent review and remediate or accept findings.                          |
| Artifact manifest                  | Ready  | `scripts/prepare-audit-artifacts.sh` generates `manifest.json` and `SHA256SUMS`.       |
| Deployment manifest                | Open   | Record code IDs, contract addresses, admins, operators, and artifact checksums.        |
| Staging deployment                 | Open   | Instantiate all contracts on a real chain and exercise core cross-contract flows.      |
| Governance feeder decentralization | Open   | Define governance v2 feeder election or formally accept the bootstrapped feeder model. |
| Frontend allowance flow            | Open   | Ensure unstake UX obtains CW20 `BurnFrom` allowance before submitting vault unstake.   |
| Release artifact signing           | Open   | Add signer identity and detached signatures if required by launch policy.              |

## Minimum Staging Drill

Before production readiness can be claimed, run a staging drill that covers:

- Instantiate CW20 staking token and vault with correct minter/address wiring.
- Stake, compound, unstake, approve, burn, unbond, and claim flows.
- Submit, assign, complete, verify, pay, and seal an AI job.
- Register a model and increment job counts through the authorized job manager.
- Activate a governance proposal with feeder-backed total-bonded snapshots.
- Pause and unpause emergency flows using production-like role separation.
- Export event logs, checksums, code IDs, and contract addresses into the
  release manifest.
