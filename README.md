<div align="center">
  <img src="README-logo.png" alt="Cruzible" width="200" />
  <h1>Cruzible</h1>
  <p><strong>Frontend, API gateway, and contract workspace for the Aethelred liquid staking stack</strong></p>
  <p>
    <a href="docs/ops/runbook.md">Ops Runbook</a> &middot;
    <a href="docs/ops/environment-reference.md">Environment Reference</a> &middot;
    <a href="docs/architecture/11-benchmarking-slos.md">Benchmarking &amp; SLOs</a> &middot;
    <a href="docs/architecture/12-public-readiness.md">Public Readiness</a>
  </p>
</div>

---

## Workspace Status

Cruzible is a pre-mainnet monorepo for the Aethelred liquid staking experience. This README is intentionally aligned to the current workspace snapshot and avoids describing routes, deployment flows, or automation that are not actually checked in here.

Some UI surfaces are production-leaning, while others still contain preview or mock fallback behavior. The operator-facing source of truth for this repository is:

- [docs/ops/runbook.md](docs/ops/runbook.md)
- [docs/ops/environment-reference.md](docs/ops/environment-reference.md)
- [docs/architecture/12-public-readiness.md](docs/architecture/12-public-readiness.md)

## Current Repo Surface

| Area | What exists in this repository now |
| --- | --- |
| Frontend | Next.js 15 app under `src/` with routes including `/`, `/vault`, `/validators`, `/jobs`, `/models`, `/seals`, `/stablecoins`, `/reconciliation`, `/devtools`, and `/governance` |
| API | Express/TypeScript service under `backend/api` with `/health`, `/health/live`, `/health/ready`, `/docs`, and `/v1/{blocks,jobs,reconciliation,alerts,stablecoins}` |
| Contracts | CosmWasm workspace under `backend/contracts/contracts/{ai_job_manager,cw20_staking,governance,model_registry,seal_manager,vault}` |
| Infra scaffolding | Frontend Dockerfile at repo root, API Dockerfile at `backend/api/Dockerfile`, `backend/infra/docker-compose.yml`, and `k8s/base/frontend.yaml` |
| Docs | README, backend README, ops runbook, env reference, readiness register, benchmarking/SLO notes, and contract audit/test reports |

## Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | `>=20.0.0` |
| npm | `>=10.0.0` |
| Rust | Needed for contract builds/tests |
| PostgreSQL | Needed for API indexing/reconciliation flows |
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

The API does not currently load `backend/.env.example` or a `.env` file automatically. Inject the variables documented in [backend/.env.example](backend/.env.example) through your shell, process manager, container runtime, or secret store before starting `backend/api`.

At minimum, plan to provide:

- `DATABASE_URL`
- `RPC_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`

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
- `GET /v1/reconciliation/status`

Protected endpoints require a bearer token, but the current API route surface does not expose a token issuance route. Operators should treat JWT provisioning as an out-of-band concern for this workspace snapshot.

### WebSocket note

The API starts a Socket.IO server on the same port as HTTP. In the current implementation, clients receive an initial `ready` event on connection; no richer event contract is documented in this repo yet.

## Common Commands

```bash
# Frontend
npm run build
npm run test
npm run test:coverage
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

- `backend/infra/docker-compose.yml` still references companion config directories that are not present in this workspace. Treat that Compose file as a hardened baseline, not a turnkey stack.
- `k8s/base/` includes frontend, API gateway, and indexer manifests. The backend manifests expect environment-specific ConfigMap values and a `cruzible-api-secrets` Secret before rollout.
- `backend/api/src/services/CacheService.ts` uses Redis when `REDIS_URL` is configured and requires Redis in production; local/test runs keep an in-memory fallback.
- `backend/api/src/services/AlertService.ts` persists alert history in PostgreSQL when `DATABASE_URL` is configured and falls back to an in-memory buffer for local/test operation.
- Some frontend surfaces remain preview-oriented. Governance explicitly guards against simulated on-chain success, and several pages use mock or fallback data for presentation.

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
- [backend/contracts/README.md](backend/contracts/README.md)
- [backend/contracts/SECURITY_AUDIT.md](backend/contracts/SECURITY_AUDIT.md)

## License

Apache 2.0. See [LICENSE](LICENSE).
