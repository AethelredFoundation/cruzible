# Public Readiness Register

> Repo-backed readiness register for the current Cruzible workspace.
> Last reconciled on 2026-04-22.

## 1. Purpose

This document is not a launch promise. It is a snapshot-aligned record of:

- what is actually implemented in this repository
- which operator documents now match that implementation
- which gaps still block a clean production or public rollout

## 2. Repo-Backed Deliverables

| Deliverable | Status | Evidence |
| --- | --- | --- |
| Top-level repo guide aligned to current route and startup surface | Ready | `README.md` |
| Backend/operator entry point aligned to current backend surface | Ready | `backend/README.md` |
| Frontend env example aligned to current `src/` usage | Ready | `.env.example` |
| Backend env example aligned to API runtime and Compose scaffold | Ready | `backend/.env.example` |
| Operator runbook aligned to implemented health, reconciliation, and rollback surfaces | Ready | `docs/ops/runbook.md` |
| Environment reference describing loading behavior and config boundaries | Ready | `docs/ops/environment-reference.md` |
| API docs from checked-in Swagger annotations | Partial | `/docs` once API is running |
| Health, liveness, and readiness endpoints | Implemented | `backend/api/src/routes/health.ts` |

## 3. Supported Surface In This Workspace

| Area | Current state |
| --- | --- |
| Frontend | Next.js pages for explorer, vault, validators, jobs, models, seals, stablecoins, reconciliation, developer tools, and governance preview |
| API | `/health`, `/health/live`, `/health/ready`, `/docs`, and `/v1/{blocks,jobs,reconciliation,alerts,stablecoins}` |
| Contracts | CosmWasm contracts for AI jobs, vault, governance, model registry, seal manager, and CW20 staking |
| Testing | Frontend Vitest, API Vitest, contract Cargo tests |
| Infra | Frontend Dockerfile, API Dockerfile, partial Compose scaffold, frontend-only Kubernetes manifest |

## 4. Current Readiness Assessment

| Area | Assessment | Notes |
| --- | --- | --- |
| Documentation baseline | Good | Core README, backend README, runbook, env reference, and readiness docs now describe checked-in surfaces instead of inferred ones |
| Config examples | Good | Frontend and backend examples now separate runtime inputs from scaffold-only values |
| API observability | Partial | Health/readiness/docs are implemented, Prometheus-compatible `/metrics` is exposed, alert history is database-backed when `DATABASE_URL` is configured, and API cache uses Redis when `REDIS_URL` is configured |
| Deployment scaffolding | Blocked | Compose references missing assets and a missing `backend/api/Dockerfile.indexer` |
| Kubernetes readiness | Partial | The frontend manifest points to the implemented `/api/health` route; a backend API manifest is still not checked in |
| Admin/ops authentication bootstrap | Partial | Wallet-backed nonce login, refresh rotation, logout revocation, and role-gated ops routes exist; production deployments must apply the auth-state migration and configure operator/admin address lists |
| Data persistence model | Partial | Prisma-backed database state exists for auth, reconciliation, indexer, and alert events; Redis-backed cache is required for production |
| Migration workflow | Partial | Development and production Prisma migration scripts exist; rollback still depends on operator-managed database snapshots |

## 5. Launch Blockers From The Current Repo State

- Complete or replace `backend/infra/docker-compose.yml` so it only references assets that exist in the repository or deployment system.
- Add a checked-in backend Kubernetes manifest matching the API gateway readiness, metrics, and secret requirements.
- Exercise the `/v1/auth` nonce/login/refresh/logout workflow in staging and provision operator/admin address lists for protected routes such as `/v1/alerts` and `/v1/reconciliation/status`.
- Exercise `npm run db:migrate:deploy` in staging and pair it with tested database snapshot/restore procedures.
- Track the temporary Next.js dependency exception in `docs/security/dependency-exceptions.md` until upstream stops bundling `postcss < 8.5.10`.

## 6. Operator Assumptions That Should Be Treated As Explicit

- Secrets are provisioned externally and rotated outside version control.
- PostgreSQL and RPC endpoints are operator-managed dependencies.
- Compose and Kubernetes artifacts in this repository are scaffolding, not complete deployment truth.
- Protected operational endpoints require externally provisioned JWTs.
- Some frontend surfaces are still preview-oriented and should not be mistaken for proof of live on-chain wiring.

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
