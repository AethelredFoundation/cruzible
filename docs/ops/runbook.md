# Cruzible Operations Runbook

> Snapshot-aligned operator guidance for this repository.
> Last reconciled against the workspace on 2026-04-28.

## 1. Scope

This runbook covers the surfaces that are implemented in the current repository:

- Next.js frontend at the repo root
- Express/TypeScript API in `backend/api`
- CosmWasm contracts in `backend/contracts`
- Readiness and environment documentation in `docs/`

This runbook does not assume that every checked-in infrastructure artifact is turnkey. In particular, `backend/infra/docker-compose.yml` still requires operator-provisioned secrets, TLS material, immutable image digests, and staging validation; environment-specific Kubernetes config/secrets also remain outside this base.

## 2. Preflight Assumptions

- Operators can provide a reachable PostgreSQL database for `DATABASE_URL`.
- Operators can provide a reachable Redis instance for `REDIS_URL`.
- Operators can provide a reachable Aethelred RPC endpoint for `RPC_URL`.
- JWT secrets are provisioned externally and are not left at development defaults.
- Compose operators can provide file-backed PostgreSQL, external `rediss://`, JWT, operational-token, Grafana, and nginx TLS secrets.
- Operator/admin wallet addresses are provisioned through `AUTH_OPERATOR_ADDRESSES`
  and `AUTH_ADMIN_ADDRESSES`.
- Backend env is injected by the runtime environment. `backend/api` does not auto-load `.env` files.
- Full `/health`, `/metrics`, `/docs`, and operational WebSocket handshakes
  require `OPERATIONAL_ENDPOINTS_TOKEN` unless a local-only runtime explicitly
  sets `ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS=true` with no token.
- Protected admin/ops endpoints use JWT bearer auth with wallet-backed nonce
  login, refresh-token rotation, and logout revocation.
- Operator/admin role changes are re-evaluated on each protected ops request
  and during refresh-token rotation, so demoted wallets cannot keep using stale
  privileged access tokens.
- Refresh-token rotation is bound to the login user-agent. IP context drift is
  logged for investigation but not rejected by default to avoid mobile/VPN lockouts.
- Operators can inspect non-secret refresh-session metadata with
  `GET /v1/auth/sessions/:address` and revoke active wallet sessions with
  `POST /v1/auth/sessions/:address/revoke`. Revocation also invalidates
  outstanding access tokens for that wallet.
- Privileged wallet and operational-token gates emit `privileged_access_audit`
  log events for successful and rejected requests. Retain these logs with the
  corresponding `requestId` during incident review.
- When PostgreSQL is configured, privileged audit decisions are persisted in the
  append-only `PrivilegedAuditEvent` table. Treat the event HMAC chain and
  `requestId` as incident evidence and preserve database snapshots before
  remediation work.

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
- `REDIS_URL`
- `RPC_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `AUTH_OPERATOR_ADDRESSES` or `AUTH_ADMIN_ADDRESSES` for protected ops access

### Build verification

```bash
# Frontend
export NEXT_PUBLIC_API_URL=https://api.testnet.aethelred.org
export NEXT_PUBLIC_CHAIN_ENV=testnet
export NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL=https://<operator-rpc>
export NEXT_PUBLIC_AETHELRED_GENESIS_HASH=0xf4b43647f4d3255a7e9321ea4b32057101ed143623390bc30d59e69a91ceafa7
npm run build

# API
cd backend/api
npm run build

# Contracts
cd ../contracts
cargo test --all
```

### Kubernetes base

`k8s/base/` contains frontend, API gateway, indexer, and database-migration
manifests. Build the frontend image with `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_CHAIN_ENV`, the selected network's explicit RPC, and
`NEXT_PUBLIC_AETHELRED_GENESIS_HASH` before rollout; Kubernetes runtime env does
not rewrite values that Next.js compiled into browser bundles. Replace
the checked-in image placeholders
with immutable `sha256` image digests in the environment overlay before rollout;
the base intentionally does not use floating tags. Before applying the backend
manifests, replace placeholder values in `cruzible-api-config`, then create the
required `cruzible-api-secrets` Secret with these keys:

- `database-url`
- `redis-url`
- `jwt-secret`
- `jwt-refresh-secret`
- `operational-endpoints-token`
- `alert-webhook-url` when alert delivery is enabled

The frontend's CSP/HSTS inputs are server-runtime inputs:
`CRUZIBLE_EXTRA_API_ORIGINS` and `CRUZIBLE_ALLOW_PLAINTEXT_HTTP` are read by
server middleware at runtime. Patch `cruzible-frontend-runtime-config` in the
environment overlay with exactly the values attested in the frontend candidate's
build-configuration fingerprint. The promotion gate runs
`scripts/validate-release-runtime-policy.mjs` and fails if either ConfigMap value
differs. Keep the checked-in empty/`false` values for TLS deployments. A pre-TLS
testnet candidate may attest a specific `http://` origin and `true`; rebuild and
re-attest the image when removing that temporary exception.

The API deployment probes `/health/live` for liveness and `/health/ready` for
readiness. The API service and pods expose Prometheus scrape annotations for
`/metrics`. The indexer manifest runs one `api-indexer` worker replica and does
not expose an HTTP service. Instead, the worker writes a process-bound heartbeat
to its bounded `/tmp` volume after initialization; startup, readiness, and
liveness exec probes run `dist/indexer-healthcheck.js`. A stale event loop or
dead worker therefore becomes unready and is restarted. The API's durable-cursor
readiness remains the network-progress signal, so RPC/database incidents are not
misclassified as a process hang. All Kubernetes workloads use a read-only root
filesystem with only a bounded `/tmp` `emptyDir` write surface, explicit
ephemeral-storage budgets, and backend Secret projections defaulted to `0440`
for non-root `fsGroup` access. API and frontend rollouts keep a zero-unavailable
rolling update strategy, minimum ready window, topology spread preferences, and
PodDisruptionBudgets so voluntary node maintenance does not drain all serving
replicas at once.
The base NetworkPolicies do not allow cross-namespace ingress by default; label
the approved ingress-controller namespace with
`networking.cruzible.io/external-ingress=true` or patch the selector in an
environment overlay before exposing the frontend or API services.

### Release image promotion

Configure the GitHub `production` environment with required reviewers before
using the manual `Cruzible CI` release path. Each matrix leg publishes only its
commit-SHA candidate, then must pass the high/critical vulnerability scan,
keyless signature, signature verification, and provenance attestation. The
separate promotion job waits for all four candidate legs (frontend, API,
indexer, and migration), the aggregate quality gate, and the environment
approval before moving their `:main` tags. Cross-repository tag updates are not
atomic, so a later failure triggers best-effort restoration of every established
channel tag already moved. A first-ever tag cannot be deleted safely; either
way, channel tags are never deployment authority.

Deploy only after the `promoted-release-images-<commit>` artifact records
`promotion_status: completed`. Use the four immutable digests in that final
inventory, including the migration image; never render a workload from `:main`
or from a partial/failed promotion plan. Validate the rendered rollout against
that completed inventory with `npm run deployment:release-images:validate --
--promotion-inventory <inventory.json> --manifest <rendered.yaml>`.

### Compose baseline

`backend/infra/docker-compose.yml` includes checked-in baselines for nginx,
Prometheus, Grafana, and the PostgreSQL initialization mount. Redis is
intentionally external: `REDIS_URL_FILE` must contain an operator-managed
`rediss://` endpoint. Before
using it outside local staging, provide all required `*_FILE` secrets, immutable
third-party image digests, `GRAFANA_ROOT_URL`, and nginx TLS certificate/key
files. Prometheus scrapes `/metrics` with the same
`OPERATIONAL_ENDPOINTS_TOKEN` that gates operational API surfaces in production.

## 4. Health and Readiness

### API endpoints

| Endpoint            | Purpose                    | Notes                                                                                       |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /health`       | Full health report         | Includes DB, RPC, memory, uptime, optional indexer state, and optional reconciliation state |
| `GET /health/live`  | Liveness probe             | Simple process-alive probe                                                                  |
| `GET /health/ready` | Readiness probe            | Fails when DB/RPC are down, indexer lag exceeds 500 blocks, or reconciliation is CRITICAL   |
| `GET /metrics`      | Prometheus scrape endpoint | Token-gated; exposes process metrics plus HTTP request count, latency, and in-flight gauges |
| `GET /docs`         | Swagger UI                 | Built from checked-in route annotations                                                     |

### Common checks

```bash
curl -s http://localhost:4001/health | jq
curl -s http://localhost:4001/health/live | jq
curl -s http://localhost:4001/health/ready | jq
curl -s http://localhost:4001/metrics | head
curl -s http://localhost:4001/v1/reconciliation/live?validator_limit=50 | jq
```

### Staged launch drill

Before approving public traffic, run the staged launch drill from the repository
commit intended for release. The dry run is CI-safe and proves the drill
contract is still maintained:

```bash
npm run readiness:launch-drill
```

Live staging mode performs HTTP checks against the deployed frontend and API,
including frontend health, critical public pages, API liveness/readiness,
anonymous rejection for full `/health`, `/metrics`, `/docs`, public
reconciliation, protected reconciliation status, and alert summary. Supply
secrets through environment variables only; do not pass token values as command
arguments:

```bash
export OPERATIONAL_ENDPOINTS_TOKEN=...
export STAGING_OPERATOR_BEARER_TOKEN=...
npm run launch:drill:staging -- \
  --frontend-url https://staging.cruzible.example \
  --api-url https://api.staging.cruzible.example \
  --evidence-file .launch-evidence/staging-$(date +%Y%m%dT%H%M%S).json
```

The evidence file records commit, checked repository evidence, endpoint status,
request timing, and sanitized response summaries. It records whether token env
vars were present, but it never records token values.

### Readiness interpretation

- Database and RPC are hard requirements for readiness.
- Indexer lag above 100 blocks degrades health; above 500 blocks makes the service not ready.
- Reconciliation `WARNING` degrades health; `CRITICAL` makes the service not ready.
- Only `/health/live` is exempt from the global rate limiter. `/health/ready`,
  full `/health`, `/metrics`, and `/docs` remain rate-limited; full `/health`,
  `/metrics`, and `/docs` are also token-gated in production.

## 5. Reconciliation and Alerts

The reconciliation scheduler starts automatically with the API process.
It compares indexed VaultState values with independent EVM reads at the exact
indexed block. Reward-driven exchange rates above 1.0 are healthy when those
sources agree, and vault TVL is never compared with network-wide validator
stake. Aggregate holder shares are reconciled with vault `totalShares`; no
single-validator ownership is fabricated for transferable stAETHEL holders.

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
- `GET /v1/audit/privileged-access` returns paginated privileged audit
  evidence for operators/admins.
- `GET /v1/audit/privileged-access/export?format=ndjson` exports the same
  sanitized evidence as newline-delimited JSON; `format=csv` is also supported.
- Rejected privileged access attempts emit rate-limited
  `PRIVILEGED_ACCESS_REJECTED` alerts, while privileged audit persistence
  failures emit `PRIVILEGED_AUDIT_PERSISTENCE_FAILURE` critical alerts.

### Important operational caveat

Alert history is persisted in PostgreSQL when `DATABASE_URL` is configured. API
cache entries are stored in Redis when `REDIS_URL` is configured. Production
requires `rediss://` Redis URLs; local/test may use `redis://` or in-process
fallbacks that are cleared on restart.

### Investigation flow when readiness fails

1. Query public `/health/ready` to confirm the deployment is not ready.
2. Query full `/health` with `Authorization: Bearer $OPERATIONAL_ENDPOINTS_TOKEN`
   or `X-Operational-Token` to inspect detailed diagnostics.
3. Check whether the failing signal is `database`, `blockchainRpc`, `indexer`, or `reconciliation`.
4. Verify `DATABASE_URL`, production `rediss://` `REDIS_URL`, and `RPC_URL` reachability from the runtime environment.
5. Inspect API logs for startup errors, Prisma failures, or indexer connection errors.
6. Confirm whether the issue is operational drift or a genuine protocol anomaly before treating it as resolved.

## 6. Database and Migration Handling

### Available commands

```bash
cd backend/api
npm run db:generate
npm run db:migrate
npm run db:migrate:status
npm run db:backup:dry-run -- --output-dir /secure/backups --label pre-migration
npm run db:backup -- --output-dir /secure/backups --label pre-migration
npm run db:migrate:deploy
```

### Safety notes

- `npm run db:migrate` maps to `prisma migrate dev`, which is appropriate for development workflows but is not, by itself, a production change-management process.
- `npm run db:migrate:status` checks whether the target database is aligned with the checked-in Prisma migrations.
- `npm run db:backup:dry-run` prints a redacted backup plan using `DATABASE_URL_FILE` or `DATABASE_URL` without invoking `pg_dump`.
- `npm run db:backup` creates a PostgreSQL custom-format `.dump` plus a JSON manifest before migration windows; it passes the password through `PGPASSWORD` instead of command-line arguments, records SHA-256 and byte size, and fails unless `pg_restore --list` can read the backup.
- `npm run db:migrate:deploy` applies checked-in migrations without creating development migration files and is the production deployment entrypoint.
- Back up PostgreSQL before destructive data operations.
- Do not rely on manual table truncation as a generic recovery procedure unless you have already captured a restorable backup and understand the downstream effects on indexer and reconciliation state.
- `PrivilegedAuditEvent` is append-only at the database layer; do not bypass the
  mutation-prevention trigger during incident handling.

### Mandatory production migration sequence

The event-identity and stAETHEL share-ledger migrations backfill or replace
indexer projections. They must never run while an old indexer process can
write those tables. This release also changes the reconciliation scheduler's
network namespace; a mixed-version rolling update would leave pre-namespace API
replicas able to emit unfenced legacy alerts. The first rollout therefore
requires a full legacy API scheduler drain as part of the same maintenance
window.

1. Put public traffic into the approved maintenance path. Scale both the API
   gateway and indexer to zero, then wait until every old pod/container and any
   in-flight reconciliation tick have exited. Do not use the normal
   `maxUnavailable: 0` rolling update for this pre-namespace-to-v2 transition.
   Set neither quiescence acknowledgement before both drains are verified.
2. With the indexer still stopped, take the pre-migration backup and verify its
   manifest and `pg_restore --list` check succeeded.
3. Run the immutable `api-migration@sha256:<digest>` image. For Compose, export
   both `CRUZIBLE_MIGRATION_QUIESCED=true` and
   `CRUZIBLE_LEGACY_SCHEDULERS_QUIESCED=true` only after
   `docker compose stop api-gateway indexer` has completed, then run
   `docker compose run --rm migrate`. For Kubernetes, set both rendered
   `migration.indexer.quiesced` and `migration.legacy.schedulers.quiesced` to
   `"true"`, delete the prior fixed-name Job with
   `kubectl -n cruzible delete job cruzible-db-migrate --ignore-not-found`, and
   apply the release manifests. The delete/recreate step is mandatory because
   Kubernetes does not rerun a completed Job on a later apply.
4. Wait for `cruzible-db-migrate` to complete and run the same image in
   `status` mode. Do not start application containers while status reports an
   unapplied or failed migration. The API/indexer `schema-ready` init
   containers provide an additional fail-closed gate; they do not apply schema.
5. Start the new indexer image and one new API replica. Wait for `/health/ready`
   to show the namespaced durable cursor, cleared rebuild marker, and lag within
   policy. Scale the new API release to its desired count, restore traffic, and
   reset both quiescence acknowledgements to `false` after the window.

If migration or projection rebuild fails, keep the indexer at zero. Preserve
the failed database for analysis and restore the verified backup before
starting the previous application image; Prisma migrations have no automatic
down migration.

## 7. Rollback Guidance

### Frontend

- Redeploy the previous image or artifact from your deployment platform.
- Re-apply the previously known-good frontend env bundle if the issue is configuration-driven.

### API

- Redeploy the previous `backend/api` image or build artifact.
- Restore the prior env bundle if the incident was introduced by config changes.
- Re-check public `/health/ready` and token-gated `/health` after rollback.

### Contracts

- There is no generic one-command contract rollback procedure documented in this workspace.
- Contract rollback, pause, or migration should follow the chain-specific admin or governance process for the deployed environment.
- Validate the intended rollback path against the actual deployed contract topology before acting.

### Contract emergency drill evidence

Before public traffic, stage a contract incident drill using production-like
role separation and record the evidence alongside the release manifest:

- Pause transaction hash, signer set, role-owner policy entry, and triggering incident scenario.
- Rejected write-flow evidence while paused, including stake/unstake or equivalent protected actions.
- Unauthorized unpause rejection evidence from a non-admin emergency role.
- Authorized unpause transaction hash with multisig approval evidence.
- Rollback or no-rollback decision record, including exact contract addresses,
  code IDs, migration plan, and reason for the selected path.
- Post-drill readiness evidence from `npm run readiness:launch-drill`,
  `npm run readiness:dr`, and the release manifest validator.

### Database

- Restore from a backup or snapshot rather than assuming an automatic Prisma rollback exists.
- Re-run readiness checks after restore.

## 8. Disaster Recovery Objectives

The repository now defines machine-checked disaster recovery objectives in
[disaster-recovery-targets.json](disaster-recovery-targets.json). Keep
`npm run readiness:dr` green before release.

Initial production targets:

- Recovery time objective: restore critical service within 240 minutes.
- Recovery point objective: lose no more than 60 minutes of state.
- Restore drill is required before public traffic.
- Database backup is required before migrations and destructive data operations.
- Privileged audit HMAC chain continuity must be preserved across restore.

Every staging or production restore drill must record commit, environment,
incident scenario, start/recovered timestamps, actual RTO/RPO, backup manifest,
readiness result, and operator approvals. These targets define the bar; they do
not replace a live restore drill against operator-managed infrastructure.
Use [restore-drill-evidence.example.json](restore-drill-evidence.example.json)
as the evidence contract and keep `npm run readiness:restore-drill` green. The
example is synthetic repository evidence; replace it with live staging or
production evidence for actual release decisions.

## 9. Known Operator Gaps In This Repo Snapshot

- `backend/infra/docker-compose.yml` requires operator-provisioned secret files, an external TLS Redis endpoint, TLS certificate/key files, immutable third-party image digests, and a staging dry run before it can be treated as production-ready.
- `k8s/base/backend.yaml` contains fail-closed placeholder config and requires environment-specific values plus the `cruzible-api-secrets` Secret before rollout; the base projects those secrets as read-only `0440` files for non-root `fsGroup` access.
- `k8s/base/network-policy.yaml` requires an explicitly labeled ingress-controller namespace before cross-namespace traffic can reach the frontend or API services.
- Production database-backed auth and alert state requires the `AuthNonce`,
  `AuthRefreshSession`, and `AlertEvent` Prisma migrations to be applied with
  `npm run db:migrate:deploy` before enabling the API gateway.

## 10. Operator Checklist

- Read [docs/ops/environment-reference.md](environment-reference.md) before provisioning config.
- Use [docs/architecture/12-public-readiness.md](../architecture/12-public-readiness.md) as the current readiness register.
- Confirm JWT secrets and CORS settings are production-safe before any shared deployment.
- Confirm `OPERATIONAL_ENDPOINTS_TOKEN` gates full `/health`, `/metrics`, and `/docs`
  while `/health/live` and minimal `/health/ready` remain usable by probes.
- Confirm production WebSocket handshakes reject missing tokens and unexpected
  origins, and that approved access-token or operational-token handshakes still
  receive the `ready` event.
- Confirm auth role address lists are set and test `/v1/auth/nonce`,
  `/v1/auth/login`, `/v1/auth/refresh`, and `/v1/auth/logout`.
- Confirm operator session incident response with `/v1/auth/sessions/:address`
  and `/v1/auth/sessions/:address/revoke`.
- Treat `backend/infra/docker-compose.yml` as a hardened baseline until required secrets, TLS material, image digests, and staging validation are complete.
- Verify all externally referenced health probes and rollout steps against the deployed environment, not just the repo.
