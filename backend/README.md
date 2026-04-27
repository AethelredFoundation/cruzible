# Cruzible Backend

This directory contains the backend-side pieces of the Cruzible workspace: the API gateway, CosmWasm contracts, node code, and infrastructure scaffolding. This README is intentionally scoped to what is actually present in the repository today.

## Directory Map

| Path | Purpose |
| --- | --- |
| `backend/api` | Express/TypeScript API gateway with health, docs, blocks, jobs, reconciliation, alerts, and stablecoin routes |
| `backend/contracts` | CosmWasm contracts plus audit/test documentation |
| `backend/node` | Aethelred node workspace and Dockerfile |
| `backend/infra` | Docker Compose scaffold for a fuller deployment footprint |
| `backend/.env.example` | Backend env template and operator reference input |

## API Gateway Surface

### Public endpoints

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET /docs`
- `GET /v1/auth/nonce`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/blocks`
- `GET /v1/jobs`
- `GET /v1/reconciliation/live`
- `GET /v1/stablecoins`

Additional route details are available from the checked-in Swagger annotations once the API is running at `/docs`.

### Protected endpoints

- `GET /v1/alerts`
- `GET /v1/alerts/summary`
- `GET /v1/reconciliation/status`

These routes require a bearer JWT with the `operator` or `admin` role. Operators
obtain tokens through the wallet-backed `/v1/auth` nonce/login flow. Configure
`AUTH_OPERATOR_ADDRESSES` and `AUTH_ADMIN_ADDRESSES` before relying on protected
ops routes in a shared environment.

### Runtime characteristics

- Health and readiness checks are implemented in `backend/api/src/routes/health.ts`.
- The Socket.IO server currently emits a `ready` event on client connection.
- `CacheService` is in-memory in this snapshot.
- `AlertService` retains alert history in-memory in this snapshot.
- The API reads environment from `process.env`; it does not automatically load `.env` files.

## Useful Commands

```bash
# Install API dependencies
cd backend/api
npm ci

# Run the API in development mode
npm run dev

# Build and test the API
npm run build
npm test
npm run test:coverage

# Contract tests
cd ../contracts
cargo test --all
```

## Environment and Ops Docs

- [backend/.env.example](.env.example)
- [docs/ops/environment-reference.md](../docs/ops/environment-reference.md)
- [docs/ops/runbook.md](../docs/ops/runbook.md)
- [docs/architecture/12-public-readiness.md](../docs/architecture/12-public-readiness.md)

## Infrastructure Caveats

- `backend/infra/docker-compose.yml` references config directories and `backend/api/Dockerfile.indexer` that are not present in this workspace.
- The checked-in Kubernetes manifest under `k8s/` is frontend-only; there is no companion backend manifest in this repo snapshot.
- Compose passes some variables such as `GRPC_URL`, `REDIS_URL`, and `INDEXER_START_HEIGHT`; they should be treated as deployment scaffolding inputs, not proof that the current API runtime consumes all of them directly.

For the up-to-date operator view, prefer the runbook and environment reference over older deployment notes or aspirational architecture text.
