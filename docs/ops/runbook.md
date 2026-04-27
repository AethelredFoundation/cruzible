# Cruzible Operations Runbook

> Snapshot-aligned operator guidance for this repository.
> Last reconciled against the workspace on 2026-04-27.

## 1. Scope

This runbook covers the surfaces that are implemented in the current repository:

- Next.js frontend at the repo root
- Express/TypeScript API in `backend/api`
- CosmWasm contracts in `backend/contracts`
- Readiness and environment documentation in `docs/`

This runbook does not assume that every checked-in infrastructure artifact is turnkey. In particular, `backend/infra/docker-compose.yml` and `k8s/base/frontend.yaml` still have gaps called out below.

## 2. Preflight Assumptions

- Operators can provide a reachable PostgreSQL database for `DATABASE_URL`.
- Operators can provide a reachable Aethelred RPC endpoint for `RPC_URL`.
- JWT secrets are provisioned externally and are not left at development defaults.
- Operator/admin wallet addresses are provisioned through `AUTH_OPERATOR_ADDRESSES`
  and `AUTH_ADMIN_ADDRESSES`.
- Backend env is injected by the runtime environment. `backend/api` does not auto-load `.env` files.
- Protected admin/ops endpoints use JWT bearer auth with wallet-backed nonce
  login, refresh-token rotation, and logout revocation.

## 3. Startup Paths

### Frontend

```bash
npm ci
cp .env.example .env.local
npm run dev
```

### API

```bash
cd backend/api
npm ci
npm run dev
```

Before starting the API, inject the variables documented in [backend/.env.example](../../backend/.env.example). The minimum viable set is:

- `DATABASE_URL`
- `RPC_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `AUTH_OPERATOR_ADDRESSES` or `AUTH_ADMIN_ADDRESSES` for protected ops access

### Build verification

```bash
# Frontend
npm run build

# API
cd backend/api
npm run build

# Contracts
cd ../contracts
cargo test --all
```

## 4. Health and Readiness

### API endpoints

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `GET /health` | Full health report | Includes DB, RPC, memory, uptime, optional indexer state, and optional reconciliation state |
| `GET /health/live` | Liveness probe | Simple process-alive probe |
| `GET /health/ready` | Readiness probe | Fails when DB/RPC are down, indexer lag exceeds 500 blocks, or reconciliation is CRITICAL |
| `GET /docs` | Swagger UI | Built from checked-in route annotations |

### Common checks

```bash
curl -s http://localhost:3001/health | jq
curl -s http://localhost:3001/health/live | jq
curl -s http://localhost:3001/health/ready | jq
curl -s http://localhost:3001/v1/reconciliation/live?validator_limit=50 | jq
```

### Readiness interpretation

- Database and RPC are hard requirements for readiness.
- Indexer lag above 100 blocks degrades health; above 500 blocks makes the service not ready.
- Reconciliation `WARNING` degrades health; `CRITICAL` makes the service not ready.
- `/health` and `/docs` are exempt from the global rate limiter.

## 5. Reconciliation and Alerts

The reconciliation scheduler starts automatically with the API process.

### Relevant env controls

- `RECONCILIATION_INTERVAL_MS`
- `RECONCILIATION_MIN_VALIDATORS`
- `RECONCILIATION_EPOCH_DURATION_S`
- `RECONCILIATION_RATE_WARN_PCT`
- `RECONCILIATION_RATE_CRIT_PCT`
- `RECONCILIATION_TVL_DRIFT_PCT`
- `ALERT_WEBHOOK_URL`
- `ALERT_RATE_LIMIT_MS`

### Route surface

- `GET /v1/reconciliation/live` is public.
- `GET /v1/reconciliation/status` requires a bearer JWT.
- `GET /v1/alerts` and `GET /v1/alerts/summary` require a bearer JWT.

### Important operational caveat

Alert history is in-memory in the current snapshot. Restarting the API clears the in-process alert buffer.

### Investigation flow when readiness fails

1. Query `/health` and `/health/ready`.
2. Check whether the failing signal is `database`, `blockchainRpc`, `indexer`, or `reconciliation`.
3. Verify `DATABASE_URL` and `RPC_URL` reachability from the runtime environment.
4. Inspect API logs for startup errors, Prisma failures, or indexer connection errors.
5. Confirm whether the issue is operational drift or a genuine protocol anomaly before treating it as resolved.

## 6. Database and Migration Handling

### Available commands

```bash
cd backend/api
npx prisma migrate status
npm run db:generate
npm run db:migrate
```

### Safety notes

- `npm run db:migrate` maps to `prisma migrate dev`, which is appropriate for development workflows but is not, by itself, a production change-management process.
- Production migration application should be reviewed and orchestrated explicitly outside this repo snapshot.
- Back up PostgreSQL before destructive data operations.
- Do not rely on manual table truncation as a generic recovery procedure unless you have already captured a restorable backup and understand the downstream effects on indexer and reconciliation state.

## 7. Rollback Guidance

### Frontend

- Redeploy the previous image or artifact from your deployment platform.
- Re-apply the previously known-good frontend env bundle if the issue is configuration-driven.

### API

- Redeploy the previous `backend/api` image or build artifact.
- Restore the prior env bundle if the incident was introduced by config changes.
- Re-check `/health` and `/health/ready` after rollback.

### Contracts

- There is no generic one-command contract rollback procedure documented in this workspace.
- Contract rollback, pause, or migration should follow the chain-specific admin or governance process for the deployed environment.
- Validate the intended rollback path against the actual deployed contract topology before acting.

### Database

- Restore from a backup or snapshot rather than assuming an automatic Prisma rollback exists.
- Re-run readiness checks after restore.

## 8. Known Operator Gaps In This Repo Snapshot

- `backend/infra/docker-compose.yml` references config directories and `backend/api/Dockerfile.indexer` that are not checked in.
- `k8s/base/frontend.yaml` currently probes `/api/health`, but the Next.js app in this repository does not implement that route.
- `backend/api` uses in-memory cache and in-memory alert history in the current implementation.
- There is no checked-in backend Kubernetes manifest matching the API gateway.
- Production auth state requires the `AuthNonce` and `AuthRefreshSession` Prisma
  migration to be applied before enabling the API gateway.

## 9. Operator Checklist

- Read [docs/ops/environment-reference.md](environment-reference.md) before provisioning config.
- Use [docs/architecture/12-public-readiness.md](../architecture/12-public-readiness.md) as the current readiness register.
- Confirm JWT secrets and CORS settings are production-safe before any shared deployment.
- Confirm auth role address lists are set and test `/v1/auth/nonce`,
  `/v1/auth/login`, `/v1/auth/refresh`, and `/v1/auth/logout`.
- Treat `backend/infra/docker-compose.yml` as a scaffold until the missing assets are supplied.
- Verify all externally referenced health probes and rollout steps against the deployed environment, not just the repo.
