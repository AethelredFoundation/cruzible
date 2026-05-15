# Cruzible Environment Reference

> Repo-aligned environment contract for the current workspace snapshot.
> Last reconciled on 2026-05-14.

## 1. Loading Behavior

- The frontend uses Next.js env loading. Copy [.env.example](../../.env.example) to `.env.local` for local development.
- `backend/api` reads from `process.env` only. It does not call `dotenv` or auto-load `backend/.env.example`.
- `backend/.env.example` should be treated as a reference template for shells, process managers, container runtimes, and secret stores.

## 2. Frontend Variables

The variables below are the ones referenced from `src/` in the current workspace.

| Variable                                | Required                     | Default / example                 | Notes                                                                                                                                                                                                                             |
| --------------------------------------- | ---------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CHAIN_ENV`                 | Build-time production input  | `devnet` locally, `testnet` in CI | Selects `mainnet`, `testnet`, or `devnet` in `src/config/chains.ts`; pass as a Docker build arg for production images                                                                                                             |
| `NEXT_PUBLIC_API_URL`                   | Required at build time       | `http://localhost:3001/v1`        | Base URL for frontend API requests; Next.js compiles this into browser bundles, so Kubernetes runtime env alone cannot change it; production mainnet/testnet builds must use the exact approved API origin for the selected chain |
| `NEXT_PUBLIC_APP_VERSION`               | No                           | `local-dev`                       | Displayed in UI and sent in request headers                                                                                                                                                                                       |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`  | Required for mainnet/testnet | blank                             | Needed for WalletConnect flows; deployed mainnet/testnet builds require a 32-character hex project ID                                                                                                                             |
| `NEXT_PUBLIC_CRUZIBLE_ADDRESS`          | Required for mainnet/testnet | blank                             | Cruzible vault contract address; deployed mainnet/testnet builds require a non-zero EVM address                                                                                                                                   |
| `NEXT_PUBLIC_STAETHEL_ADDRESS`          | Required for mainnet/testnet | blank                             | Liquid staking receipt token address; deployed mainnet/testnet builds require a non-zero EVM address                                                                                                                              |
| `NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS`      | Required for mainnet/testnet | blank                             | Underlying token address; deployed mainnet/testnet builds require a non-zero EVM address                                                                                                                                          |
| `NEXT_PUBLIC_GOVERNANCE_ADDRESS`        | Optional                     | blank                             | Governance remains preview-oriented in this snapshot                                                                                                                                                                              |
| `NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS` | Required for mainnet/testnet | blank                             | Stablecoin bridge contract address; deployed mainnet/testnet builds require a non-zero EVM address                                                                                                                                |
| `NEXT_PUBLIC_USDC_TOKEN_ADDRESS`        | Required for mainnet/testnet | blank                             | Stablecoin token address; deployed mainnet/testnet builds require a non-zero EVM address                                                                                                                                          |
| `NEXT_PUBLIC_USDT_TOKEN_ADDRESS`        | Required for mainnet/testnet | blank                             | Stablecoin token address; deployed mainnet/testnet builds require a non-zero EVM address                                                                                                                                          |
| `NEXT_PUBLIC_ENABLE_DEVTOOLS`           | Optional                     | `false`                           | Local/devnet only; must be explicitly `true`; production hard-disables `/devtools` even if this public flag is set                                                                                                                |
| `NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL`      | Optional                     | `http://127.0.0.1:8000`           | Used by `/devtools`; must stay a localhost HTTP(S) origin when devtools are enabled                                                                                                                                               |
| `NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL`       | Optional                     | `http://127.0.0.1:3000`           | Used by `/devtools`; must stay a localhost HTTP(S) origin when devtools are enabled                                                                                                                                               |
| `NEXT_PUBLIC_DEVTOOLS_RPC_URL`          | Optional                     | `http://127.0.0.1:26657`          | Used by `/devtools`; must stay a localhost HTTP(S) origin when devtools are enabled                                                                                                                                               |

Production frontend images must be built with explicit public config:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.testnet.aethelred.org \
  --build-arg NEXT_PUBLIC_CHAIN_ENV=testnet \
  --build-arg NEXT_PUBLIC_CRUZIBLE_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_STAETHEL_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_USDC_TOKEN_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_USDT_TOKEN_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=0123456789abcdef0123456789abcdef \
  -t cruzible-frontend:staging .
```

Mainnet frontend release images use the same explicit compiled public contract
configuration, pointed at the mainnet API and mainnet contract deployments:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.mainnet.aethelred.org \
  --build-arg NEXT_PUBLIC_CHAIN_ENV=mainnet \
  --build-arg NEXT_PUBLIC_CRUZIBLE_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_STAETHEL_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_USDC_TOKEN_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_USDT_TOKEN_ADDRESS=0x... \
  --build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=0123456789abcdef0123456789abcdef \
  -t cruzible-frontend:mainnet .
```

Use `NEXT_PUBLIC_CHAIN_ENV=devnet` for localhost API builds. Production
`mainnet` and `testnet` builds reject localhost, lookalike domains, and any API
origin other than the exact approved origin for that chain.

Vercel preview builds use `scripts/vercel-build.mjs` to default missing public
config to deterministic testnet preview values. Vercel production deployments
must configure explicit `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHAIN_ENV`, contract
addresses, and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` values.

## 3. API Runtime Variables

These variables are validated or consumed by `backend/api` in the current snapshot.

| Variable                                      | Required                               | Default / example                                                        | Notes                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                    | No                                     | `development`                                                            | `production` adds stricter startup checks                                                                                                                                                                                         |
| `PORT`                                        | No                                     | `3001`                                                                   | HTTP and Socket.IO listen port                                                                                                                                                                                                    |
| `RPC_URL`                                     | Yes in production                      | `http://127.0.0.1:26657`                                                 | Used by health checks and blockchain service calls; must use `http://` or `https://`; production startup rejects implicit defaults                                                                                                |
| `DATABASE_URL`                                | Yes in production                      | `postgresql://cruzible:...`                                              | Required for Prisma-backed health, indexing, and reconciliation; must use `postgresql://` or `postgres://` and must not include URL fragments                                                                                     |
| `REDIS_URL`                                   | Yes in production                      | local `redis://localhost:6379`; production `rediss://cache.example:6379` | Required for cross-instance API cache and distributed rate-limit counters in production; optional in local/test; production startup requires `rediss://`                                                                          |
| `CORS_ORIGINS`                                | Yes in shared environments             | `http://localhost:3000`                                                  | Comma-separated; production rejects wildcard, local, private, and reserved test/example origins                                                                                                                                   |
| `JWT_SECRET`                                  | Yes                                    | replace with secret                                                      | Development defaults, values shorter than 32 characters in production, control characters, and reuse with refresh/ops secrets are rejected                                                                                        |
| `JWT_REFRESH_SECRET`                          | Yes                                    | replace with secret                                                      | Development defaults, values shorter than 32 characters in production, control characters, and reuse with access/ops secrets are rejected                                                                                         |
| `LOG_HASH_SECRET`                             | Yes in production                      | replace with secret                                                      | Keyed HMAC secret for privacy-preserving request/audit IP and user-agent hashes; production rejects the development default, short values, control characters, and reuse with JWT signing secrets                                 |
| `JWT_EXPIRES_IN`                              | No                                     | `15m`                                                                    | Must match the `^[1-9]\d*[mhd]$` pattern; production rejects values longer than `15m`                                                                                                                                             |
| `JWT_REFRESH_EXPIRES_IN`                      | No                                     | `7d`                                                                     | Must match the `^[1-9]\d*[hd]$` pattern; production rejects values longer than `30d`                                                                                                                                              |
| `AUTH_EXPOSE_REFRESH_TOKEN_IN_BODY`           | No                                     | local/test `true`, production `false`                                    | Compatibility escape hatch for non-production tooling; production startup rejects `true` because refresh tokens should travel in HttpOnly cookies                                                                                 |
| `TRUST_PROXY`                                 | No                                     | `loopback`                                                               | Express trust proxy setting; production rejects unbounded `true`, use a hop count such as `1` behind ingress                                                                                                                      |
| `RATE_LIMIT_WINDOW_MS`                        | No                                     | `60000`                                                                  | Global limiter window                                                                                                                                                                                                             |
| `RATE_LIMIT_MAX`                              | No                                     | `120`                                                                    | Global limiter max request count                                                                                                                                                                                                  |
| `METRICS_ENABLED`                             | No                                     | `true`                                                                   | Controls `/metrics`; access is gated by `OPERATIONAL_ENDPOINTS_TOKEN` unless a local-only unauthenticated bypass is explicit                                                                                                      |
| `API_DOCS_ENABLED`                            | No                                     | local/test `true`, production `false`                                    | Controls Swagger UI at `/docs`; access is gated by `OPERATIONAL_ENDPOINTS_TOKEN` unless a local-only unauthenticated bypass is explicit                                                                                           |
| `OPERATIONAL_ENDPOINTS_TOKEN`                 | Required for shared/prod ops surfaces  | blank                                                                    | Bearer or `X-Operational-Token` credential for full `/health`, `/metrics`, `/docs`, and operational WebSocket handshakes; must be at least 32 characters, contain no control characters, and be distinct from JWT signing secrets |
| `ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS` | Local-only                             | `false`                                                                  | Explicit local bypass for full `/health`, `/metrics`, and `/docs` when no operational token is configured; production rejects `true`, and shared/staging environments should keep this false                                      |
| `ALLOW_MOCK_SIGNATURES`                       | No                                     | `false`                                                                  | Development-only escape hatch; blocked in production                                                                                                                                                                              |
| `AUTH_OPERATOR_ADDRESSES`                     | Required in production for ops access  | blank                                                                    | Comma-separated `aeth1...` wallet addresses that receive the `operator` role at login                                                                                                                                             |
| `AUTH_ADMIN_ADDRESSES`                        | Required in production for ops access  | blank                                                                    | Comma-separated `aeth1...` wallet addresses that receive `operator` and `admin` roles at login                                                                                                                                    |
| `AUTH_NONCE_TTL_MS`                           | No                                     | `300000`                                                                 | Wallet login challenge lifetime; production rejects values longer than 10 minutes                                                                                                                                                 |
| `AUTH_RATE_LIMIT_WINDOW_MS`                   | No                                     | `60000`                                                                  | Auth route limiter window                                                                                                                                                                                                         |
| `AUTH_RATE_LIMIT_MAX`                         | No                                     | `10`                                                                     | Auth route max request count                                                                                                                                                                                                      |
| `OPS_RATE_LIMIT_WINDOW_MS`                    | No                                     | `60000`                                                                  | Protected ops route limiter window                                                                                                                                                                                                |
| `OPS_RATE_LIMIT_MAX`                          | No                                     | `60`                                                                     | Protected ops route max request count                                                                                                                                                                                             |
| `INDEXER_ENABLED`                             | No                                     | `true`                                                                   | Enables startup of the API-side indexer service                                                                                                                                                                                   |
| `INDEXER_RPC_URL`                             | Required if production indexer enabled | `http://127.0.0.1:8545`                                                  | JSON-RPC endpoint used by the indexer service; must use `http://` or `https://`                                                                                                                                                   |
| `INDEXER_WS_URL`                              | Required if production indexer enabled | `ws://127.0.0.1:8546`                                                    | WebSocket endpoint used by the indexer service; must use `ws://` or `wss://`                                                                                                                                                      |
| `INDEXER_START_BLOCK`                         | No                                     | `0`                                                                      | API-side indexer start height                                                                                                                                                                                                     |
| `INDEXER_EXPECTED_CHAIN_ID`                   | Required if production indexer enabled | blank                                                                    | EVM chain ID the indexer must observe before startup; production refuses to index if RPC returns a different chain                                                                                                                |
| `CRUZIBLE_VAULT_ADDRESS`                      | Required if production indexer enabled | blank                                                                    | Must be blank or a non-zero EVM address                                                                                                                                                                                           |
| `STAETHEL_ADDRESS`                            | Required if production indexer enabled | blank                                                                    | Must be blank or a non-zero EVM address                                                                                                                                                                                           |
| `STABLECOIN_BRIDGE_ADDRESS`                   | Required if production indexer enabled | blank                                                                    | Must be blank or a non-zero EVM address                                                                                                                                                                                           |
| `ALERT_WEBHOOK_URL`                           | Optional                               | blank                                                                    | Must be a valid URL when set                                                                                                                                                                                                      |
| `ALERT_RATE_LIMIT_MS`                         | No                                     | `300000`                                                                 | Suppression window for duplicate alert categories                                                                                                                                                                                 |
| `RECONCILIATION_INTERVAL_MS`                  | No                                     | `300000`                                                                 | Scheduler interval                                                                                                                                                                                                                |
| `RECONCILIATION_MIN_VALIDATORS`               | No                                     | `4`                                                                      | Minimum active validators expected                                                                                                                                                                                                |
| `RECONCILIATION_EPOCH_DURATION_S`             | No                                     | `3600`                                                                   | Expected epoch duration                                                                                                                                                                                                           |
| `RECONCILIATION_RATE_WARN_PCT`                | No                                     | `0.01`                                                                   | Exchange rate drift warning threshold                                                                                                                                                                                             |
| `RECONCILIATION_RATE_CRIT_PCT`                | No                                     | `0.05`                                                                   | Must be greater than `RECONCILIATION_RATE_WARN_PCT`                                                                                                                                                                               |
| `RECONCILIATION_TVL_DRIFT_PCT`                | No                                     | `0.02`                                                                   | TVL drift threshold                                                                                                                                                                                                               |

## 4. Compose and Scaffold Variables

The variables below are referenced by `backend/infra/docker-compose.yml`. They should be treated as scaffold inputs, not proof that the current API runtime consumes each value directly.

| Variable                           | Used by                        | Notes                                                                                                         |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `RPC_URL`                          | api-gateway / indexer          | Required chain RPC URL                                                                                        |
| `GRPC_URL`                         | api-gateway passthrough        | Required by the Compose contract even though backend config ignores it                                        |
| `CORS_ORIGINS`                     | api-gateway / indexer          | Required; production rejects wildcard, local, private, and reserved test/example origins                      |
| `DATABASE_URL_FILE`                | api-gateway / indexer / secret | File containing the Prisma PostgreSQL URL                                                                     |
| `REDIS_URL_FILE`                   | api-gateway / indexer / secret | File containing the Redis URL, including auth when Redis auth is used; production values must use `rediss://` |
| `REDIS_PASSWORD_FILE`              | redis secret                   | File containing the Redis `requirepass` value                                                                 |
| `DB_USER`                          | postgres                       | PostgreSQL bootstrap user                                                                                     |
| `DB_PASSWORD_FILE`                 | postgres secret                | File containing the PostgreSQL bootstrap password                                                             |
| `DB_NAME`                          | postgres + health checks       | Shared Compose database name                                                                                  |
| `JWT_SECRET_FILE`                  | api-gateway / indexer / secret | File containing the API JWT signing secret                                                                    |
| `JWT_REFRESH_SECRET_FILE`          | api-gateway / indexer / secret | File containing the API refresh-token signing secret                                                          |
| `LOG_HASH_SECRET_FILE`             | api-gateway / indexer / secret | File containing the keyed HMAC secret for privacy-preserving log/audit hashes                                 |
| `OPERATIONAL_ENDPOINTS_TOKEN_FILE` | api-gateway / prometheus       | File containing the operational bearer token for metrics/docs/health                                          |
| `INDEXER_RPC_URL`                  | indexer                        | JSON-RPC endpoint used by the indexer service                                                                 |
| `INDEXER_WS_URL`                   | indexer                        | WebSocket endpoint used by the indexer service                                                                |
| `INDEXER_START_HEIGHT`             | indexer                        | Compose maps this to API runtime `INDEXER_START_BLOCK`                                                        |
| `INDEXER_EXPECTED_CHAIN_ID`        | indexer                        | Required chain ID guard                                                                                       |
| `CRUZIBLE_VAULT_ADDRESS`           | indexer                        | Required non-zero vault contract address                                                                      |
| `STAETHEL_ADDRESS`                 | indexer                        | Required non-zero liquid staking token address                                                                |
| `STABLECOIN_BRIDGE_ADDRESS`        | indexer                        | Required non-zero stablecoin bridge address                                                                   |
| `CRUZIBLE_API_IMAGE_DIGEST`        | api-gateway                    | Immutable first-party release image digest                                                                    |
| `CRUZIBLE_INDEXER_IMAGE_DIGEST`    | indexer                        | Immutable first-party release image digest                                                                    |
| `POSTGRES_IMAGE_DIGEST`            | postgres                       | Immutable third-party image digest                                                                            |
| `REDIS_IMAGE_DIGEST`               | redis                          | Immutable third-party image digest                                                                            |
| `NGINX_IMAGE_DIGEST`               | nginx                          | Immutable third-party image digest                                                                            |
| `PROMETHEUS_IMAGE_DIGEST`          | prometheus                     | Immutable third-party image digest                                                                            |
| `GRAFANA_USER`                     | grafana                        | Grafana bootstrap user                                                                                        |
| `GRAFANA_PASSWORD_FILE`            | grafana secret                 | File containing the Grafana bootstrap password                                                                |
| `GRAFANA_ROOT_URL`                 | grafana                        | Required Grafana external URL                                                                                 |
| `GRAFANA_IMAGE_DIGEST`             | grafana                        | Immutable third-party image digest                                                                            |
| `JAEGER_IMAGE_DIGEST`              | jaeger                         | Immutable third-party image digest                                                                            |
| `NGINX_TLS_CERT_FILE`              | nginx secret                   | File containing the TLS certificate                                                                           |
| `NGINX_TLS_KEY_FILE`               | nginx secret                   | File containing the TLS private key                                                                           |

## 5. Important Caveats

- `REDIS_URL` is consumed by `backend/api/src/services/CacheService.ts`. Production startup refuses to run without it and requires a `rediss://` URL, while local/test runs may use `redis://` or the in-memory fallback.
- `GRPC_URL` appears in node-facing Compose scaffolding but is not part of the API config contract enforced by `backend/api/src/config/index.ts`.
- HTTP CORS allows credentials only for configured `CORS_ORIGINS`; keep this list exact because browser refresh-token cookies depend on credentialed requests.
- Protected `/v1` ops endpoints require bearer JWTs issued through the `/v1/auth` wallet nonce/login flow.
- Privileged audit retrieval and export endpoints are mounted under `/v1/audit` and require `operator` or `admin` bearer JWTs.
- Operator/admin role changes are re-evaluated on every protected ops request and when refresh tokens rotate, so removing a wallet from `AUTH_OPERATOR_ADDRESSES` or `AUTH_ADMIN_ADDRESSES` blocks stale privileged access tokens as well as future refreshed tokens.
- Refresh-token rotation requires the same user-agent context recorded at login. IP context changes are logged as drift signals but are not rejected by default.
- Login and refresh responses set an HttpOnly, `SameSite=Strict` refresh cookie. Production uses `__Host-cruzible_refresh`; local/test uses `cruzible_refresh` because the `__Host-` prefix requires `Secure`.
- Production refresh/logout requests require HttpOnly-cookie refresh-token presentation plus a trusted `Origin` or `Referer` that matches `CORS_ORIGINS`; JSON request-body refresh tokens remain available only outside production for local/tooling compatibility.
- Operators can inspect non-secret refresh-session metadata via `GET /v1/auth/sessions/:address` and revoke active wallet refresh sessions plus outstanding access tokens via `POST /v1/auth/sessions/:address/revoke`.
- Privileged wallet and operational-token gates emit `privileged_access_audit` log events with request ID, principal type, decision, outcome, and response status for audit correlation. When `DATABASE_URL` is configured, the same decisions are persisted in append-only `PrivilegedAuditEvent` rows with hashed IP/user-agent values and HMAC-linked evidence.
- Rejected privileged access attempts also emit sanitized `PRIVILEGED_ACCESS_REJECTED` alerts; audit persistence failures emit critical `PRIVILEGED_AUDIT_PERSISTENCE_FAILURE` alerts without raw IP, user-agent, or token values.
- Operational surfaces (full `/health`, `/metrics`, and `/docs`) use `OPERATIONAL_ENDPOINTS_TOKEN`, accepted as `Authorization: Bearer <token>` or `X-Operational-Token: <token>`. A non-production runtime may bypass this only with `ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS=true` and no configured operational token. The checked-in Prometheus baseline reads this token from `/run/secrets/cruzible_operational_token` instead of exposing metrics anonymously.
- Alert history uses PostgreSQL when `DATABASE_URL` is configured and falls back to in-memory history only when database-backed API state is unavailable.
- `backend/infra/docker-compose.yml` includes checked-in nginx, Redis, Prometheus, Grafana, and PostgreSQL init baselines, but it still requires real secret files, TLS material, immutable first-party and third-party image digests, and staging validation.
- `backend/infra/docker-compose.yml` binds internal API, database, RPC, cache, and observability ports to loopback by default; only nginx and the P2P listener are public-facing in the scaffold.
- `k8s/base/` expects environment overlays to replace checked-in image placeholders with immutable `sha256` digests before rollout.
- `k8s/base/` keeps workload roots read-only, grants only a bounded `/tmp` `emptyDir` write surface, and sets container ephemeral-storage budgets so staging can catch unexpected runtime writes before public rollout.
- `k8s/base/` sets rollout deadlines, revision history limits, termination grace periods, topology spread preferences for serving replicas, and PodDisruptionBudgets for API, frontend, and indexer workloads.
- `k8s/base/network-policy.yaml` accepts frontend/API ingress only from the same-namespace frontend pods or namespaces labeled `networking.cruzible.io/external-ingress=true`; label the approved ingress-controller namespace or patch the selector in the target overlay.
- `k8s/base/backend.yaml` expects non-secret runtime config in `cruzible-api-config` and secret values in `cruzible-api-secrets` with keys `database-url`, `redis-url`, `jwt-secret`, `jwt-refresh-secret`, `log-hash-secret`, and `operational-endpoints-token`; backend secret files are projected read-only with `0440` permissions so non-root pods can read them via `fsGroup: 1001`.

## 6. Production Hygiene Rules Already Enforced In Code

When `NODE_ENV=production`, API startup refuses to run with:

- missing explicit `RPC_URL`
- missing `DATABASE_URL`
- missing `REDIS_URL`
- non-`rediss://` `REDIS_URL`
- development JWT secrets
- JWT secrets shorter than 32 characters
- JWT or operational endpoint secrets containing control characters
- JWT access lifetimes longer than 15 minutes or refresh lifetimes longer than 30 days
- zero token lifetimes or minute-based refresh token lifetimes
- wallet login nonce lifetimes longer than 10 minutes
- wildcard `CORS_ORIGINS`
- `ALLOW_MOCK_SIGNATURES=true`
- `ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS=true`
- `AUTH_EXPOSE_REFRESH_TOKEN_IN_BODY=true`
- no configured `AUTH_OPERATOR_ADDRESSES` or `AUTH_ADMIN_ADDRESSES`
- unbounded `TRUST_PROXY=true`
- exposed `/metrics` or `/docs` endpoints without `OPERATIONAL_ENDPOINTS_TOKEN`
- `INDEXER_ENABLED=true` without explicit indexer RPC/WebSocket URLs, expected chain ID, and all contract addresses

Environment validation also rejects malformed URLs, unsupported database/RPC/indexer
URL protocols, malformed or zero EVM addresses, malformed auth role wallet
addresses, and reconciliation thresholds where the critical exchange-rate
threshold is not greater than the warning threshold.

The `/v1/auth` routes persist nonce and refresh-token rotation state in the
`AuthNonce` and `AuthRefreshSession` database tables when `DATABASE_URL` is set.
Alert history is persisted in `AlertEvent`. Apply the matching Prisma migrations
before enabling production traffic.

Treat these checks as the baseline production contract, not a complete production
hardening program.
