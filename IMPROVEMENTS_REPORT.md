# Cruzible Hardening Register

**Last reconciled:** 2026-05-03

**Status:** Active remediation register, not a production approval.

This file records the current hardening track for audit readiness. It replaces
older inflated readiness claims with repo-verifiable evidence and remaining
launch blockers.

## Completed Hardening

| Area                       | Evidence                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency posture         | Root, backend API, TypeScript SDK, and contract audit gates are configured; `docs/security/dependency-exceptions.md` records no active accepted production exceptions |
| CI coverage                | GitHub Actions run frontend quality/build, backend API, contracts, dependency review, npm audits, Cargo audit, and CodeQL                                             |
| Contract hygiene           | Contract formatting, clippy, tests, release build, and artifact checksum scripts are part of CI                                                                       |
| Backend health             | API liveness/readiness probes are split so infrastructure does not depend on the protected full `/health` diagnostic endpoint                                         |
| Frontend browser hardening | CSP, frame-ancestor denial, and restrictive permissions policy headers are configured                                                                                 |
| Public link safety         | Validator operator website links are rendered only when they are valid `http` or `https` URLs                                                                         |
| API query validation       | Jobs pricing estimates and queue limits are bounded and rejected before service calls when invalid                                                                    |
| Frontend deploy config     | `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_CHAIN_ENV` are validated at build time and passed to Docker builds as public build args                                        |

## Remaining Launch Blockers

| Priority | Gap              | Required outcome                                                                                                       |
| -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P0       | External audits  | Attach findings and remediations from independent contract/application audits                                          |
| P0       | Staging evidence | Capture successful deployment, migration, health, rollback, and alert drills on real infrastructure                    |
| P0       | Live integration | Verify wallet, staking, validator, governance, stablecoin, and privileged-ops flows against deployed contracts and API |
| P1       | Infra overlays   | Complete environment-specific Kubernetes overlays, ingress/TLS, backup/restore, and DDoS posture                       |
| P1       | E2E tests        | Add browser/API e2e coverage for the critical user and operator paths                                                  |
| P1       | Monitoring proof | Confirm metrics, alert routing, privileged audit persistence, and incident response workflows under load               |

## Verification Commands

```bash
npm run lint
npm run type-check
npm run format:check
npm test
NEXT_PUBLIC_API_URL=https://api.testnet.aethelred.org NEXT_PUBLIC_CHAIN_ENV=testnet npm run build

cd backend/api
npm run lint
npm test
npm run build

cd ../contracts
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
cargo audit -D warnings
```

## Readiness Rule

Cruzible should remain marked pre-mainnet until the launch blockers above are
closed with evidence. A green CI run is necessary, but it is not sufficient for
production approval.
