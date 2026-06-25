<div align="center">
  <img src="README-logo.png" alt="Cruzible" width="200" />
  <h1>Cruzible</h1>
  <p><strong>Frontend, API gateway, and contract workspace for the Aethelred liquid staking stack</strong></p>
  <p>
    <a href="docs/ops/runbook.md">Ops Runbook</a> &middot;
    <a href="docs/ops/environment-reference.md">Environment Reference</a> &middot;
    <a href="docs/architecture/11-benchmarking-slos.md">Benchmarking &amp; SLOs</a> &middot;
    <a href="docs/architecture/12-public-readiness.md">Public Readiness</a> &middot;
    <a href="docs/architecture/13-production-gap-register.md">Production Gap Register</a> &middot;
    <a href="docs/architecture/public-route-inventory.json">Route Inventory</a>
  </p>
</div>

---

## Workspace Status

Cruzible is a pre-mainnet monorepo for the Aethelred liquid staking experience. This README is intentionally aligned to the current workspace snapshot and avoids describing routes, deployment flows, or automation that are not actually checked in here.

Runtime UI surfaces are expected to fail closed, show readiness-gated states, or stay empty when live data is unavailable instead of rendering seeded/mock fallback data. Test-only request mocks live under `src/mocks` and are guarded from production imports. The operator-facing source of truth for this repository is:

- [docs/ops/runbook.md](docs/ops/runbook.md)
- [docs/ops/environment-reference.md](docs/ops/environment-reference.md)
- [docs/architecture/12-public-readiness.md](docs/architecture/12-public-readiness.md)
- [docs/architecture/13-production-gap-register.md](docs/architecture/13-production-gap-register.md)
- [docs/architecture/public-route-inventory.json](docs/architecture/public-route-inventory.json)

## Current Repo Surface

| Area              | What exists in this repository now                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend          | Next.js 15 app under `src/` with machine-checked public route inventory for `/`, `/vault`, `/validators`, `/jobs`, `/models`, `/seals`, `/stablecoins`, `/reconciliation`, `/devtools`, `/governance`, and `/api/health` |
| API               | Express/TypeScript service under `backend/api` with `/health`, `/health/live`, `/health/ready`, `/docs`, and `/v1/{blocks,jobs,reconciliation,alerts,stablecoins}`                                                       |
| Contracts         | CosmWasm workspace under `backend/contracts/contracts/{ai_job_manager,cw20_staking,governance,model_registry,seal_manager,vault}`                                                                                        |
| Infra scaffolding | Frontend Dockerfile at repo root, API Dockerfile at `backend/api/Dockerfile`, `backend/infra/docker-compose.yml`, and `k8s/base/frontend.yaml`                                                                           |
| Docs              | README, backend README, ops runbook, env reference, readiness register, benchmarking/SLO notes, and contract audit/test reports                                                                                          |

## Prerequisites

| Tool          | Version                                             |
| ------------- | --------------------------------------------------- |
| Node.js       | `>=20.0.0`                                          |
| npm           | `>=10.0.0`                                          |
| Rust          | Needed for contract builds/tests                    |
| PostgreSQL    | Needed for API indexing/reconciliation flows        |
| Aethelred RPC | Needed for API health, indexing, and reconciliation |

## Local Development

### Frontend

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The frontend uses Next.js environment loading, so `.env.local` is the expected local override file.

### API

```bash
cd backend/api
npm ci
npm run dev
```

The API does not currently load `backend/.env.example` or a `.env` file automatically. Inject the variables documented in [backend/.env.example](backend/.env.example) through your shell, process manager, container runtime, or secret store before starting `backend/api`. Production deployments should prefer the supported `*_FILE` variables for high-value settings such as database URLs, JWT secrets, operational endpoint tokens, and alert webhooks.

At minimum, plan to provide:

- `DATABASE_URL`
- `RPC_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`

When both a direct secret variable and its matching `*_FILE` variable are set,
startup fails closed to avoid ambiguous secret provenance.

## Implemented API Surface

### Public endpoints

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET /docs`
- `GET /v1/blocks`
- `GET /v1/blocks/latest`
- `GET /v1/blocks/:height`
- `GET /v1/blocks/:height/transactions`
- `GET /v1/jobs`
- `GET /v1/jobs/stats`
- `GET /v1/jobs/pricing`
- `GET /v1/jobs/:id`
- `GET /v1/jobs/:id/verifications`
- `GET /v1/jobs/queue`
- `GET /v1/reconciliation/live`
- `GET /v1/stablecoins`
- `GET /v1/stablecoins/:assetId`
- `GET /v1/stablecoins/:assetId/history`
- `GET /v1/stablecoins/:assetId/status`

### JWT-protected endpoints

- `GET /v1/alerts`
- `GET /v1/alerts/summary`
- `GET /v1/audit/privileged-access`
- `GET /v1/audit/privileged-access/export`
- `GET /v1/reconciliation/status`

Protected endpoints require bearer JWTs issued through the wallet-backed
`/v1/auth` nonce/login flow. Operator and admin roles must be present in the
token and still match the current `AUTH_OPERATOR_ADDRESSES` or
`AUTH_ADMIN_ADDRESSES` allowlists when the request is made.

### WebSocket note

The API starts a Socket.IO server on the same port as HTTP. Clients receive an
initial `ready` event after connection middleware succeeds. Production
handshakes require an allowed origin plus a valid API access token or
`OPERATIONAL_ENDPOINTS_TOKEN`, and active connections are capped per client IP.

## Common Commands

```bash
# Frontend
export NEXT_PUBLIC_API_URL=https://api.testnet.aethelred.org
export NEXT_PUBLIC_CHAIN_ENV=testnet
npm run build
npm run test
npm run test:coverage
npm run accessibility:check
npm run mobile:check
npm run readiness:routes
npm run readiness:launch-drill
npm run launch:drill:staging -- --frontend-url https://staging.example --api-url https://api.staging.example --evidence-file .launch-evidence/staging.json
npm run analyze

# API
cd backend/api
npm run build
npm test
npm run test:coverage

# Contracts
cd backend/contracts
cargo test --all
```

## Known Repo-Reality Gaps

- `backend/infra/docker-compose.yml` now includes checked-in nginx, Redis, Prometheus, Grafana, and PostgreSQL init baselines, but it still requires operator-provisioned secrets, TLS material, immutable image digests, and staging validation before production use.
- `k8s/base/` includes frontend, API gateway, and indexer manifests with read-only roots, bounded `/tmp` write surfaces, scoped ingress NetworkPolicies, ephemeral-storage budgets, rollout/disruption safeguards, and `0440` backend secret-file projections for non-root `fsGroup` access. The backend manifests still expect environment-specific ConfigMap values and a `cruzible-api-secrets` Secret before rollout.
- Frontend public-data requests require `NEXT_PUBLIC_API_URL` at build time because Next.js public env is compiled into browser bundles; Docker images must pass `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_CHAIN_ENV` as build args, and production mainnet/testnet builds accept only the approved chain-specific API origin.
- `backend/api/src/services/CacheService.ts` uses Redis when `REDIS_URL` is configured and requires TLS Redis URLs in production; local/test runs keep an in-memory fallback.
- `backend/api/src/services/AlertService.ts` persists alert history in PostgreSQL when `DATABASE_URL` is configured and falls back to an in-memory buffer for local/test operation.
- Some frontend surfaces remain preview-oriented. Runtime pages fail closed, stay empty, or show readiness gates instead of presenting seeded/mock data as live protocol state.

## Repository Guide

```text
cruzible/
├── src/                      # Next.js frontend
├── backend/
│   ├── api/                  # Express / TypeScript API gateway
│   ├── contracts/            # CosmWasm contracts and audit docs
│   ├── node/                 # Aethelred node workspace
│   └── infra/                # Infrastructure scaffolding
├── docs/                     # Ops, readiness, and architecture notes
├── k8s/                      # Checked-in Kubernetes base manifests
├── sdk/                      # TypeScript and Python SDKs
└── specs/                    # Protocol/specification notes
```

## Further Reading

- [backend/README.md](backend/README.md)
- [docs/ops/runbook.md](docs/ops/runbook.md)
- [docs/ops/environment-reference.md](docs/ops/environment-reference.md)
- [docs/architecture/11-benchmarking-slos.md](docs/architecture/11-benchmarking-slos.md)
- [docs/architecture/12-public-readiness.md](docs/architecture/12-public-readiness.md)
- [docs/architecture/public-route-inventory.json](docs/architecture/public-route-inventory.json)
- [backend/contracts/README.md](backend/contracts/README.md)
- [backend/contracts/SECURITY_AUDIT.md](backend/contracts/SECURITY_AUDIT.md)

## License

Apache 2.0. See [LICENSE](LICENSE).
