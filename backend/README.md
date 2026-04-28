# Cruzible Backend

This directory contains the backend-side pieces of the Cruzible workspace: the API gateway, CosmWasm contracts, node code, and infrastructure scaffolding. This README is intentionally scoped to what is actually present in the repository today.

## Directory Map

| Path                   | Purpose                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `backend/api`          | Express/TypeScript API gateway with health, docs, blocks, jobs, reconciliation, alerts, and stablecoin routes |
| `backend/contracts`    | CosmWasm contracts plus audit/test documentation                                                              |
| `backend/node`         | Aethelred node workspace and Dockerfile                                                                       |
| `backend/infra`        | Docker Compose scaffold for a fuller deployment footprint                                                     |
| `backend/.env.example` | Backend env template and operator reference input                                                             |

## API Gateway Surface

### Public endpoints

- `GET /health/live`
- `GET /health/ready`
- `GET /v1/auth/nonce`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/blocks`
- `GET /v1/jobs`
- `GET /v1/reconciliation/live`
- `GET /v1/stablecoins`

Additional route details are available from the checked-in Swagger annotations when `/docs` is enabled.

### Protected endpoints

- `GET /health`
- `GET /metrics`
- `GET /docs`
- `GET /v1/auth/sessions/:address`
- `POST /v1/auth/sessions/:address/revoke`
- `GET /v1/alerts`
- `GET /v1/alerts/summary`
- `GET /v1/reconciliation/status`

`/health/live` remains a public liveness probe. `/health/ready` remains public
for infrastructure probes, but production responses only expose a minimal
ready/not-ready result. Full `/health`, `/metrics`, and `/docs` diagnostics are
local-friendly but production-gated by `OPERATIONAL_ENDPOINTS_TOKEN`; docs
default to disabled in production unless `API_DOCS_ENABLED=true` is set. The
`/v1` protected routes require a bearer JWT with the `operator` or `admin` role.
Operators
obtain tokens through the wallet-backed `/v1/auth` nonce/login flow. Configure
at least one `AUTH_OPERATOR_ADDRESSES` or `AUTH_ADMIN_ADDRESSES` value before
relying on protected ops routes; production startup fails closed when both are
empty or malformed.
Refresh-session incident endpoints expose non-secret metadata only and support
bulk revocation of active refresh sessions for a wallet.

### Runtime characteristics

- Health and readiness checks are implemented in `backend/api/src/routes/health.ts`.
- Prometheus-compatible HTTP metrics are exposed at `GET /metrics`.
- The Socket.IO server currently emits a `ready` event on client connection.
- `CacheService` uses Redis when `REDIS_URL` is configured and falls back to an in-memory cache for local/test operation.
- `AlertService` persists alert history in PostgreSQL when `DATABASE_URL` is configured and falls back to an in-memory buffer for local/test operation.
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
npm run db:migrate:status
npm run db:migrate:deploy

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

- `backend/infra/docker-compose.yml` references config directories that are not present in this workspace.
- The checked-in Kubernetes base under `k8s/base/` includes frontend, API gateway, and indexer manifests.
- Compose passes `GRPC_URL` to node-facing services and maps `INDEXER_START_HEIGHT` to the API runtime `INDEXER_START_BLOCK`.

For the up-to-date operator view, prefer the runbook and environment reference over older deployment notes or aspirational architecture text.
