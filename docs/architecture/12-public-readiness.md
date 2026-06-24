# Public Readiness Register

> Repo-backed readiness register for the current Cruzible workspace.
> Last reconciled on 2026-06-24.

## 1. Purpose

This document is not a launch promise. It is a snapshot-aligned record of:

- what is actually implemented in this repository
- which operator documents now match that implementation
- which gaps still block a clean production or public rollout

## 2. Repo-Backed Deliverables

| Deliverable                                                                           | Status      | Evidence                            |
| ------------------------------------------------------------------------------------- | ----------- | ----------------------------------- |
| Top-level repo guide aligned to current route and startup surface                     | Ready       | `README.md`                         |
| Backend/operator entry point aligned to current backend surface                       | Ready       | `backend/README.md`                 |
| Frontend env example aligned to current `src/` usage                                  | Ready       | `.env.example`                      |
| Backend env example aligned to API runtime and Compose scaffold                       | Ready       | `backend/.env.example`              |
| Operator runbook aligned to implemented health, reconciliation, and rollback surfaces | Ready       | `docs/ops/runbook.md`               |
| Environment reference describing loading behavior and config boundaries               | Ready       | `docs/ops/environment-reference.md` |
| API docs from checked-in Swagger annotations                                          | Partial     | `/docs` once API is running         |
| Health, liveness, and readiness endpoints                                             | Implemented | `backend/api/src/routes/health.ts`  |

## 3. Supported Surface In This Workspace

| Area      | Current state                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | Next.js pages for explorer, vault, validators, jobs, models, seals, stablecoins, reconciliation, developer tools, and governance preview    |
| API       | `/health`, `/health/live`, `/health/ready`, `/docs`, and `/v1/{auth,audit,blocks,jobs,reconciliation,alerts,stablecoins}`                    |
| Contracts | CosmWasm contracts for AI jobs, vault, governance, model registry, seal manager, and CW20 staking                                           |
| Testing   | Frontend Vitest, API Vitest, contract Cargo tests                                                                                           |
| Infra     | Frontend Dockerfile, API Dockerfile, contract artifact Dockerfile, partial Compose scaffold, frontend/API/indexer Kubernetes base manifests |

## 4. Current Readiness Assessment

| Area                               | Assessment | Notes                                                                                                                                                                                                                              |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation baseline             | Good       | Core README, backend README, runbook, env reference, and readiness docs now describe checked-in surfaces instead of inferred ones                                                                                                  |
| Config examples                    | Good       | Frontend and backend examples now separate runtime inputs from scaffold-only values                                                                                                                                                |
| API observability                  | Partial    | Public liveness/readiness probes are implemented, full `/health`, `/metrics`, and `/docs` are token-gated in production, alert history is database-backed when `DATABASE_URL` is configured, and API cache uses Redis when `REDIS_URL` is configured |
| Deployment scaffolding             | Partial    | Compose now builds API and indexer targets from the repository root and includes checked-in nginx, Redis, Prometheus, Grafana, and PostgreSQL init baselines; operator secrets, TLS material, immutable image digests, and staging validation are still required |
| Kubernetes readiness               | Partial    | Frontend, API gateway, and indexer manifests are checked in with fail-closed config/secret requirements, read-only roots, bounded `/tmp` write surfaces, secret file permissions, scoped ingress NetworkPolicies, and ephemeral-storage budgets; staging validation is still required |
| Admin/ops authentication bootstrap | Partial    | Wallet-backed nonce login, context-bound refresh rotation, logout revocation, refresh-session incident endpoints, current-role checks, access-token revocation watermarks, append-only privileged audit evidence, and operator audit retrieval/export endpoints exist; production startup now requires at least one configured operator/admin wallet and deployments must apply auth migrations |
| Realtime gateway                   | Partial    | Production Socket.IO handshakes require allowed origins plus access or operational tokens, and active connections are capped per client IP; end-to-end staging validation is still required |
| Data persistence model             | Partial    | Prisma-backed database state exists for auth, reconciliation, indexer, and alert events; Redis-backed cache is required for production                                                                                             |
| Dependency exception posture       | Good       | Root, backend API, TypeScript SDK, and contract dependency audits report zero high-or-above vulnerabilities; `docs/security/dependency-exceptions.md` has no active accepted exceptions |
| Migration workflow                 | Partial    | Development and production Prisma migration scripts exist; rollback still depends on operator-managed database snapshots                                                                                                           |

## 5. Launch Blockers From The Current Repo State

- Stage-test `backend/infra/docker-compose.yml` with real secret files, Redis credentials, TLS certificate/key files, immutable third-party image digests, and operator-approved external origins.
- Capture a contract staging release manifest with wasm checksums, code IDs, contract addresses, and role owners.
- Stage-test `k8s/base/` with real `cruzible-api-config` values, a provisioned `cruzible-api-secrets` Secret, a labeled ingress-controller namespace or equivalent overlay, and workload checks that confirm the bounded `/tmp` mounts are sufficient for runtime writes.
- Build frontend images with `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_CHAIN_ENV` Docker build args; frontend public-data requests fail closed when the API URL is missing, points at the wrong network, or uses a lookalike origin instead of the approved chain-specific API origin.
- Exercise the `/v1/auth` nonce/login/refresh/logout and session revocation workflow in staging, then provision validated operator/admin address lists for protected routes such as `/v1/alerts` and `/v1/reconciliation/status`.
- Exercise `npm run db:migrate:deploy` in staging and pair it with tested database snapshot/restore procedures.

## 6. Operator Assumptions That Should Be Treated As Explicit

- Secrets are provisioned externally and rotated outside version control.
- PostgreSQL and RPC endpoints are operator-managed dependencies.
- Compose and Kubernetes artifacts in this repository are hardened scaffolding, not complete deployment truth.
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
