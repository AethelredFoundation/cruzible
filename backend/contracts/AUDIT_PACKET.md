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
`RELEASE_SIGNING.md` documents cosign and GPG detached-signature flows for the
checksums and manifest.

## Deployment Assumptions

- Release manifests must conform to
  `deployments/release-manifest.example.json` and pass
  `python3 scripts/validate-release-manifest.py <manifest>`.
- The CW20 staking token is instantiated with the vault contract as minter.
- The vault `staking_token` config points to the deployed CW20 staking token.
- Vault unstake uses the staking token `BurnFrom` flow, so users must approve
  the vault before unstaking.
- Operator, pauser, verifier, feeder, and admin roles are controlled by
  production key management outside this repository.
- Governance total-bonded feeder submissions must come from independent
  staking-module observers. The contract enforces multi-feeder consensus,
  bounded tolerance, mutation cooldown, quarantine, and epoch invalidation; the
  remaining decentralization residual is feeder membership governance.
- Seal creation depends on the configured AI job manager address returning
  canonical job state.
- Model registry job-count updates depend on the configured AI job manager
  address after deployment.
- Contract instantiation, migration, and address wiring must be recorded in a
  release manifest before any production deployment.

## Known Residual Review Items

These are not hidden TODOs. They are explicit pre-production review items:

| Item                               | Status  | Required action                                                                                                         |
| ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| External audit                     | Open    | Complete independent review and remediate or accept findings.                                                           |
| Artifact manifest                  | Ready   | `scripts/prepare-audit-artifacts.sh` generates `manifest.json` and `SHA256SUMS`.                                        |
| Deployment manifest template       | Ready   | `deployments/release-manifest.example.json` is validated in CI.                                                         |
| Staging deployment manifest        | Open    | Record real code IDs, contract addresses, admins, operators, and artifact checksums.                                    |
| Staging deployment                 | Open    | Instantiate all contracts on a real chain and exercise core cross-contract flows.                                       |
| Governance feeder decentralization | Partial | Multi-feeder consensus is implemented and config-validated; feeder membership remains admin-governed until v2 election. |
| Frontend allowance flow            | Ready   | Vault unstake checks stAETHEL allowance and obtains exact approval before submission.                                   |
| Release artifact signing           | Partial | Signing and verification scripts are checked in; production signatures still require release keys.                      |

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
- Sign and verify `SHA256SUMS` and `manifest.json` using the production
  artifact signer.
- Validate the completed release manifest with
  `python3 scripts/validate-release-manifest.py`.
