# Cruzible Smart Contracts

CosmWasm smart contracts for the Cruzible verification and staking protocol.

Status: **audit-candidate / pre-production hardening**.

The current workspace includes remediations for prior critical findings and passes local contract tests. It is not mainnet ready until external audit, deployment scripts, staging validation, real chain integration, and remaining TODOs are complete.

## Contracts

| Contract         | Purpose                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `ai_job_manager` | Manages AI job lifecycle, assignment, verification, and payment settlement.                             |
| `seal_manager`   | Creates and verifies seals tied to upstream job evidence.                                               |
| `model_registry` | Registers models, validates registration fees, and tracks authorized job usage.                         |
| `governance`     | Handles proposals, snapshot voting power, quorum, and execution controls.                               |
| `vault`          | Handles staking, unbonding, reward accounting, stAETHEL mint/burn calls, and vault accounting controls. |
| `cw20_staking`   | CW20-compatible staking token functionality.                                                            |

## Current Hardening Evidence

Implemented remediation areas:

- Vault reward index, double-claim protection, stAETHEL mint/burn lifecycle, rounding controls, and donation/accounted-balance controls.
- AI job Paid-state guard to prevent repeated settlement.
- Governance snapshot, quorum, multi-feeder total-bonded oracle, and governance-controlled feeder membership controls.
- Model registry registration fee amount/denom enforcement, job-manager authorization, and verified-job count updates from the AI job manager.
- Seal manager cross-contract job check.

Vault unstake uses the staking token `BurnFrom` flow, so frontends or transaction builders must obtain user allowance for the vault before unstaking. The web vault flow checks stAETHEL allowance and requests exact approval before submitting an unstake transaction.

Local `cargo test` from `backend/contracts` passes with 244 tests:

| Suite            | Passing tests |
| ---------------- | ------------: |
| `vault`          |            24 |
| `ai_job_manager` |            52 |
| `cw20_staking`   |            42 |
| `governance`     |            49 |
| `model_registry` |            50 |
| `seal_manager`   |            27 |
| Doc tests        |             0 |

## Build and Test

```bash
cd backend/contracts
cargo test
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo build --release --target wasm32-unknown-unknown
python3 scripts/validate-release-manifest.py deployments/release-manifest.example.json
python3 scripts/test-validate-release-manifest.py
bash -n scripts/sign-audit-artifacts.sh
bash -n scripts/verify-audit-artifact-signatures.sh
```

The `Contracts` CI job also publishes wasm files and `SHA256SUMS` as a
commit-scoped audit artifact. `scripts/prepare-audit-artifacts.sh` also writes
`manifest.json` with file sizes and checksums. The local Dockerfile mirrors
that artifact build path and prints the generated checksums by default.
`RELEASE_SIGNING.md` defines the cosign and GPG detached-signature process for
release artifacts. Completed staging manifests should be checked with
`python3 scripts/validate-release-manifest.py --strict <manifest> --artifact-dir audit-artifacts/contracts`
after signatures are generated.
The manifest also records each contract's exact instantiate message and funds,
plus required post-instantiate actions, including the CW20 staking token
`UpdateMinter` transaction that hands mint authority to the vault and the model
registry `UpdateConfig` transaction that authorizes the deployed AI job
manager.

## Audit-Candidate Checklist

Before external audit:

- [x] Prior critical remediations implemented in live code.
- [x] Local `cargo test` passes with 244 tests.
- [x] CI workflow enforces test, fmt, clippy, and wasm release build gates.
- [x] CI workflow uploads commit-scoped wasm artifacts, checksums, and manifest.
- [x] Known residual review items documented for auditor review.
- [x] Deployment assumptions and contract address wiring documented.
- [x] Release manifest template is checked in and validated in CI.
- [x] Release manifest validator reconciles strict staging manifests with signed artifact evidence.
- [x] Release manifest validator checks instantiate messages and funds against reviewed role/config wiring.
- [x] Release manifest validator checks required post-instantiate CW20 minter and model registry role wiring actions.
- [x] Release artifact signing and verification scripts are checked in.
- [x] Governance feeder quorum, tolerance, mutation, quarantine, capacity, and production authority config is validated.
- [ ] Staging release manifest captured with code IDs, addresses, checksums, and role owners.

Before production readiness:

- [ ] External audit completed.
- [ ] Audit findings remediated or explicitly risk accepted.
- [ ] Deployment scripts completed and reviewed.
- [ ] Production artifact signatures generated and verified.
- [ ] Staging validation completed on a real chain.
- [ ] End-to-end cross-contract integration validated.
- [ ] Operational runbooks completed for keys, upgrades, pauses, monitoring, and incident response.

## Documentation

- `SECURITY_AUDIT.md` records the current security review state.
- `SECURITY_COMPLIANCE_REPORT.md` summarizes remediation and launch blockers.
- `TEST_COVERAGE.md` records current test evidence and coverage limits.
- `security_best_practices_report.md` summarizes audit-candidate assurance evidence.
- `AUDIT_PACKET.md` records scope, artifact, deployment-assumption, and staging-drill inputs for auditors.
- `RELEASE_SIGNING.md` records the artifact signing and verification process.
- `deployments/release-manifest.example.json` defines the required staging release manifest shape.

## License

Apache 2.0. See `../../LICENSE`.
