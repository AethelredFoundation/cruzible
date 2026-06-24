# Cruzible Hardening Register

**Last reconciled:** 2026-05-14

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
| Frontend route smoke       | Playwright production smoke tests cover health, landing, devtools gating, and the critical public route shells under an upstream API outage                           |
| Jobs surfaces              | Jobs explorer and job detail pages use the production dark shell, SEO metadata, live API data only, and explicit degraded states instead of synthetic rows            |

## Remaining Launch Blockers

| Priority | Gap              | Required outcome                                                                                                       |
| -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P0       | External audits  | Attach findings and remediations from independent contract/application audits                                          |
| P0       | Staging evidence | Capture successful deployment, migration, health, rollback, and alert drills on real infrastructure                    |
| P0       | Live integration | Verify wallet, staking, validator, governance, stablecoin, and privileged-ops flows against deployed contracts and API |
| P1       | Infra overlays   | Complete environment-specific Kubernetes overlays, ingress/TLS, backup/restore, and DDoS posture                       |
| P1       | E2E depth        | Extend browser/API e2e coverage from route smoke into wallet, transaction, privileged-ops, and recovery journeys       |
| P1       | Monitoring proof | Confirm metrics, alert routing, privileged audit persistence, and incident response workflows under load               |

## Verification Commands

```bash
npm run lint
npm run type-check
npm run format:check
npm test
npm run test:e2e
NEXT_PUBLIC_API_URL=https://api.testnet.aethelred.org \
NEXT_PUBLIC_CHAIN_ENV=testnet \
NEXT_PUBLIC_CRUZIBLE_ADDRESS=0x1111111111111111111111111111111111111111 \
NEXT_PUBLIC_STAETHEL_ADDRESS=0x2222222222222222222222222222222222222222 \
NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS=0x3333333333333333333333333333333333333333 \
NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS=0x4444444444444444444444444444444444444444 \
NEXT_PUBLIC_USDC_TOKEN_ADDRESS=0x5555555555555555555555555555555555555555 \
NEXT_PUBLIC_USDT_TOKEN_ADDRESS=0x6666666666666666666666666666666666666666 \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=7a4f9c2e1b8d43c6a095f2e7d4b1c830 \
npm run build

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
