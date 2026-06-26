# Public Readiness Register

> Repo-backed readiness register for the current Cruzible workspace.
> Last reconciled on 2026-06-26.

## 1. Purpose

This document is not a launch promise. It is a snapshot-aligned record of:

- what is actually implemented in this repository
- which operator documents now match that implementation
- which gaps still block a clean production or public rollout

## 2. Repo-Backed Deliverables

| Deliverable                                                                           | Status      | Evidence                                                                       |
| ------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| Top-level repo guide aligned to current route and startup surface                     | Ready       | `README.md`                                                                    |
| Backend/operator entry point aligned to current backend surface                       | Ready       | `backend/README.md`                                                            |
| Frontend env example aligned to current `src/` usage                                  | Ready       | `.env.example`                                                                 |
| Backend env example aligned to API runtime and Compose scaffold                       | Ready       | `backend/.env.example`                                                         |
| Operator runbook aligned to implemented health, reconciliation, and rollback surfaces | Ready       | `docs/ops/runbook.md`                                                          |
| Environment reference describing loading behavior and config boundaries               | Ready       | `docs/ops/environment-reference.md`                                            |
| Public frontend route inventory checked against `src/pages`                           | Ready       | `docs/architecture/public-route-inventory.json` and `npm run readiness:routes` |
| Unsupported launch-claim scanner for public copy                                      | Ready       | `scripts/validate-launch-claims.mjs` and `npm run readiness:claims`            |
| Launch-facing accessibility baseline checked in production E2E                        | Ready       | `e2e/accessibility-readiness.spec.ts` and `npm run accessibility:check`        |
| Mobile viewport readiness for core launch surfaces                                    | Ready       | `e2e/mobile-readiness.spec.ts` and `npm run mobile:check`                      |
| Synthetic performance journey budgets for critical launch routes                      | Ready       | `e2e/performance-budget.spec.ts` and `npm run performance:journey`             |
| API liveness benchmark release gate                                                   | Ready       | `backend/api/scripts/benchmark-health.mjs` and `npm run performance:api`       |
| Staged launch drill contract with sanitized evidence output                           | Ready       | `scripts/staged-launch-drill.mjs` and `npm run readiness:launch-drill`         |
| API docs from checked-in Swagger annotations                                          | Partial     | `/docs` once API is running                                                    |
| Health, liveness, and readiness endpoints                                             | Implemented | `backend/api/src/routes/health.ts`                                             |

## 3. Supported Surface In This Workspace

| Area      | Current state                                                                                                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | Machine-checked Next.js public route inventory and accessibility readiness coverage for explorer, vault, launch-gated governance, validators, jobs, models, seals, stablecoins, reconciliation, dev-only tooling, and `/api/health` |
| API       | `/health`, `/health/live`, `/health/ready`, `/docs`, and `/v1/{auth,audit,blocks,jobs,reconciliation,alerts,stablecoins}`                                                                                                           |
| Contracts | CosmWasm contracts for AI jobs, vault, governance, model registry, seal manager, and CW20 staking                                                                                                                                   |
| Testing   | Frontend Vitest, API Vitest, contract Cargo tests                                                                                                                                                                                   |
| Infra     | Frontend Dockerfile, API Dockerfile, contract artifact Dockerfile, partial Compose scaffold, frontend/API/indexer Kubernetes base manifests                                                                                         |

## 4. Current Readiness Assessment

| Area                               | Assessment | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation baseline             | Good       | Core README, backend README, runbook, env reference, and readiness docs now describe checked-in surfaces instead of inferred ones                                                                                                                                                                                                                                                               |
| Config examples                    | Good       | Frontend and backend examples now separate runtime inputs from scaffold-only values                                                                                                                                                                                                                                                                                                             |
| API observability                  | Partial    | Public liveness/readiness probes are implemented, full `/health`, `/metrics`, and `/docs` are token-gated in production, alert history is database-backed when `DATABASE_URL` is configured, API cache uses Redis when `REDIS_URL` is configured, and checked-in API benchmark thresholds are CI-validated before release                                                                       |
| Deployment scaffolding             | Partial    | Compose now builds API and indexer targets from the repository root and includes checked-in nginx, Redis, Prometheus, Grafana, and PostgreSQL init baselines; CI validates digest images, localhost-only internal ports, and externalized secret files; operator secrets, TLS material, immutable image digests, and staging validation are still required                                      |
| Kubernetes readiness               | Partial    | Frontend, API gateway, and indexer manifests are checked in with fail-closed config/secret requirements, read-only roots, bounded `/tmp` write surfaces, secret file permissions, scoped ingress NetworkPolicies, ephemeral-storage budgets, and CI-enforced structured manifest validation; staging validation is still required                                                               |
| Admin/ops authentication bootstrap | Partial    | Wallet-backed nonce login, context-bound refresh rotation, logout revocation, refresh-session incident endpoints, current-role checks, access-token revocation watermarks, append-only privileged audit evidence, and operator audit retrieval/export endpoints exist; production startup now requires at least one configured operator/admin wallet and deployments must apply auth migrations |
| Realtime gateway                   | Partial    | Production Socket.IO handshakes require allowed origins plus access or operational tokens, and active connections are capped per client IP; end-to-end staging validation is still required                                                                                                                                                                                                     |
| Data persistence model             | Partial    | Prisma-backed database state exists for auth, reconciliation, indexer, and alert events; Redis-backed cache is required for production                                                                                                                                                                                                                                                          |
| Dependency exception posture       | Good       | Root, backend API, TypeScript SDK, and contract dependency audits report zero high-or-above vulnerabilities; `docs/security/dependency-exceptions.md` has no active accepted exceptions                                                                                                                                                                                                         |
| Accessibility readiness            | Good       | Playwright now blocks launch-facing regressions for skip-link wiring, main landmarks, visible H1s, document metadata, labeled navigation/footer landmarks, duplicate ids, interactive accessible names, visible form labels, image alt attributes, and vault tab panels                                                                                                                         |
| Mobile readiness                   | Good       | Mobile Playwright coverage now exercises vault, validators, and stablecoin launch surfaces under upstream API outage and blocks horizontal overflow regressions                                                                                                                                                                                                                                 |
| Frontend performance readiness     | Good       | Playwright now enforces synthetic route budgets for launch-facing routes, including DOMContentLoaded, load, first contentful paint when available, same-origin transfer, resource count, and runtime error checks under upstream API outage                                                                                                                                                     |
| Staged launch drill                | Partial    | `npm run readiness:launch-drill` keeps the drill contract alive in CI, and `npm run launch:drill:staging` can exercise staging frontend/API health, readiness, operational-token gating, public reconciliation, protected reconciliation status, and alert summary with sanitized JSON evidence once staging URLs and tokens exist                                                              |
| Migration workflow                 | Partial    | Development and production Prisma migration scripts exist, and the backend now includes a redacted PostgreSQL backup helper for pre-migration snapshots; restore drills still depend on operator-managed database infrastructure                                                                                                                                                                |

## 5. Launch Blockers From The Current Repo State

- Stage-test `backend/infra/docker-compose.yml` with real secret files, Redis credentials, TLS certificate/key files, immutable third-party image digests, and operator-approved external origins.
- Capture a contract staging release manifest with wasm checksums, code IDs, contract addresses, and role owners.
- Stage-test `k8s/base/` with real `cruzible-api-config` values, a provisioned `cruzible-api-secrets` Secret, a labeled ingress-controller namespace or equivalent overlay, and workload checks that confirm the bounded `/tmp` mounts are sufficient for runtime writes.
- Build frontend images with `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_CHAIN_ENV` Docker build args; frontend public-data requests fail closed when the API URL is missing, points at the wrong network, or uses a lookalike origin instead of the approved chain-specific API origin.
- Keep `npm run readiness:routes` green before release so new public pages are explicitly marked ready, launch-gated, operational, or dev-only.
- Keep `npm run readiness:claims` green before release so public copy cannot introduce unsupported production-ready, mainnet-ready, risk-free, guaranteed-yield, or external-audit claims.
- Keep `npm run accessibility:check` green before release so launch-facing routes retain keyboard skip-link targets, labeled controls, and baseline landmark semantics.
- Keep `npm run performance:journey` green before release so launch-facing routes stay inside synthetic DCL, load, FCP, transfer, resource-count, and runtime-error budgets.
- Keep `npm run performance:api` green before release so API benchmark thresholds remain parseable and fail-closed, then run `cd backend/api && npm run benchmark -- --url <staging-api>/health/live` against staging before traffic promotion.
- Keep `npm run release:sbom` green before release, and archive the SPDX output from `npm run release:sbom:write` with the image digest inventory and contract artifacts for the same commit.
- Keep CI runtime image scans green so frontend, API, indexer, and release images fail on high-or-critical OS or library findings before promotion.
- Keep manual release provenance evidence attached to release images and signed contract artifact bundles before promotion.
- Keep validator data-quality tests green so source freshness, universe-hash, reconciliation, epoch-source, and risk-component disclosures do not regress.
- Keep the vault risk-intelligence tests green so staking, exchange-rate, reward-proof, and withdrawal-liquidity disclosures do not regress into unsupported product claims.
- Keep the stablecoin bridge risk tests green so settlement, fee, phase, domain, approval, and live-limit disclosures do not regress into unsupported product claims.
- Keep `npm run readiness:launch-drill` green in CI, then run `npm run launch:drill:staging -- --frontend-url <staging frontend> --api-url <staging api> --evidence-file .launch-evidence/<release>.json` with `OPERATIONAL_ENDPOINTS_TOKEN` and `STAGING_OPERATOR_BEARER_TOKEN` set before approving production traffic.
- Exercise the `/v1/auth` nonce/login/refresh/logout and session revocation workflow in staging, then provision validated operator/admin address lists for protected routes such as `/v1/alerts` and `/v1/reconciliation/status`.
- Exercise `npm run db:backup`, `npm run db:migrate:deploy`, and a database restore drill in staging before enabling public traffic.

## 6. Operator Assumptions That Should Be Treated As Explicit

- Secrets are provisioned externally and rotated outside version control.
- PostgreSQL and RPC endpoints are operator-managed dependencies.
- Compose and Kubernetes artifacts in this repository are hardened scaffolding, not complete deployment truth.
- The Kubernetes base now denies arbitrary backend egress; the `k8s/overlays/production-egress/` allowlist must be replaced with real PostgreSQL, Redis, RPC, and alert webhook CIDRs before a cluster rollout.
- Full operational diagnostics require `OPERATIONAL_ENDPOINTS_TOKEN`; protected
  `/v1` operational endpoints require externally provisioned JWTs.
- Some frontend surfaces are still preview-oriented and should not be mistaken for proof of live on-chain wiring.
- `/devtools` is hard-disabled in production and must be explicitly enabled for local/test diagnostics.

## 7. Exit Criteria Before Public Or Production Use

- All missing deployment assets are supplied or the incomplete scaffolding is replaced with a supported path.
- Health probes in manifests match real application endpoints.
- JWT issuance/admin bootstrap is documented and testable.
- Production secret, CORS, and signature-verification settings are verified in the target environment.
- Migration application and rollback procedures are approved for the target deployment platform.
- Operators validate the repo-backed docs against the exact deployment artifact and commit being released.

## 8. Cross-References

- [README.md](../../README.md)
- [backend/README.md](../../backend/README.md)
- [docs/ops/runbook.md](../ops/runbook.md)
- [docs/ops/environment-reference.md](../ops/environment-reference.md)
- [docs/security/dependency-exceptions.md](../security/dependency-exceptions.md)
- [docs/architecture/11-benchmarking-slos.md](11-benchmarking-slos.md)
- [docs/architecture/13-production-gap-register.md](13-production-gap-register.md)
- [docs/architecture/public-route-inventory.json](public-route-inventory.json)
