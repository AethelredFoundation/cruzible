# Cruzible Environment Reference

> Repo-aligned environment contract for the current workspace snapshot.
> Last reconciled on 2026-04-27.

## 1. Loading Behavior

- The frontend uses Next.js env loading. Copy [.env.example](../../.env.example) to `.env.local` for local development.
- `backend/api` reads from `process.env` only. It does not call `dotenv` or auto-load `backend/.env.example`.
- `backend/.env.example` should be treated as a reference template for shells, process managers, container runtimes, and secret stores.

## 2. Frontend Variables

The variables below are the ones referenced from `src/` in the current workspace.

| Variable | Required | Default / example | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CHAIN_ENV` | No | `testnet` | Selects `mainnet`, `testnet`, or `devnet` in `src/config/chains.ts` |
| `NEXT_PUBLIC_API_URL` | Recommended | `http://localhost:3001/v1` | Base URL for frontend API requests |
| `NEXT_PUBLIC_APP_VERSION` | No | `local-dev` | Displayed in UI and sent in request headers |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional | blank | Needed for WalletConnect flows |
| `NEXT_PUBLIC_CRUZIBLE_ADDRESS` | Optional | blank | Contract address placeholder |
| `NEXT_PUBLIC_STAETHEL_ADDRESS` | Optional | blank | Contract address placeholder |
| `NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS` | Optional | blank | Contract address placeholder |
| `NEXT_PUBLIC_GOVERNANCE_ADDRESS` | Optional | blank | Governance remains preview-oriented in this snapshot |
| `NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS` | Optional | blank | Stablecoin bridge contract address |
| `NEXT_PUBLIC_USDC_TOKEN_ADDRESS` | Optional | blank | Stablecoin token address |
| `NEXT_PUBLIC_USDT_TOKEN_ADDRESS` | Optional | blank | Stablecoin token address |
| `NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL` | Optional | `http://127.0.0.1:8000` | Used by `/devtools` |
| `NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL` | Optional | `http://127.0.0.1:3000` | Used by `/devtools` |
| `NEXT_PUBLIC_DEVTOOLS_RPC_URL` | Optional | `http://127.0.0.1:26657` | Used by `/devtools` |

## 3. API Runtime Variables

These variables are validated or consumed by `backend/api` in the current snapshot.

| Variable | Required | Default / example | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | `production` adds stricter startup checks |
| `PORT` | No | `3001` | HTTP and Socket.IO listen port |
| `RPC_URL` | Yes in production | `http://127.0.0.1:26657` | Used by health checks and blockchain service calls; production startup rejects implicit defaults |
| `DATABASE_URL` | Yes in production | `postgresql://cruzible:...` | Required for Prisma-backed health, indexing, and reconciliation |
| `CORS_ORIGINS` | Yes in shared environments | `http://localhost:3000` | Comma-separated; wildcard is rejected in production |
| `JWT_SECRET` | Yes | replace with secret | Development defaults are rejected in production |
| `JWT_REFRESH_SECRET` | Yes | replace with secret | Development defaults are rejected in production |
| `JWT_EXPIRES_IN` | No | `1h` | Must match the `^\d+[hd]$` pattern |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Must match the `^\d+[hd]$` pattern |
| `TRUST_PROXY` | No | `loopback` | Express trust proxy setting |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Global limiter window |
| `RATE_LIMIT_MAX` | No | `120` | Global limiter max request count |
| `ALLOW_MOCK_SIGNATURES` | No | `false` | Development-only escape hatch; blocked in production |
| `AUTH_OPERATOR_ADDRESSES` | Recommended for ops access | blank | Comma-separated wallet addresses that receive the `operator` role at login |
| `AUTH_ADMIN_ADDRESSES` | Recommended for ops access | blank | Comma-separated wallet addresses that receive `operator` and `admin` roles at login |
| `AUTH_NONCE_TTL_MS` | No | `300000` | Wallet login challenge lifetime |
| `AUTH_RATE_LIMIT_WINDOW_MS` | No | `60000` | Auth route limiter window |
| `AUTH_RATE_LIMIT_MAX` | No | `10` | Auth route max request count |
| `OPS_RATE_LIMIT_WINDOW_MS` | No | `60000` | Protected ops route limiter window |
| `OPS_RATE_LIMIT_MAX` | No | `60` | Protected ops route max request count |
| `INDEXER_ENABLED` | No | `true` | Enables startup of the API-side indexer service |
| `INDEXER_RPC_URL` | Required if production indexer enabled | `http://127.0.0.1:8545` | JSON-RPC endpoint used by the indexer service |
| `INDEXER_WS_URL` | Required if production indexer enabled | `ws://127.0.0.1:8546` | WebSocket endpoint used by the indexer service |
| `INDEXER_START_BLOCK` | No | `0` | API-side indexer start height |
| `CRUZIBLE_VAULT_ADDRESS` | Required if production indexer enabled | blank | Must be blank or a non-zero EVM address |
| `STAETHEL_ADDRESS` | Required if production indexer enabled | blank | Must be blank or a non-zero EVM address |
| `STABLECOIN_BRIDGE_ADDRESS` | Required if production indexer enabled | blank | Must be blank or a non-zero EVM address |
| `ALERT_WEBHOOK_URL` | Optional | blank | Must be a valid URL when set |
| `ALERT_RATE_LIMIT_MS` | No | `300000` | Suppression window for duplicate alert categories |
| `RECONCILIATION_INTERVAL_MS` | No | `300000` | Scheduler interval |
| `RECONCILIATION_MIN_VALIDATORS` | No | `4` | Minimum active validators expected |
| `RECONCILIATION_EPOCH_DURATION_S` | No | `3600` | Expected epoch duration |
| `RECONCILIATION_RATE_WARN_PCT` | No | `0.01` | Exchange rate drift warning threshold |
| `RECONCILIATION_RATE_CRIT_PCT` | No | `0.05` | Must be greater than `RECONCILIATION_RATE_WARN_PCT` |
| `RECONCILIATION_TVL_DRIFT_PCT` | No | `0.02` | TVL drift threshold |

## 4. Compose and Scaffold Variables

The variables below are referenced by `backend/infra/docker-compose.yml`. They should be treated as scaffold inputs, not proof that the current API runtime consumes each value directly.

| Variable | Used by | Notes |
| --- | --- | --- |
| `CHAIN_ID` | node / seed-node scaffolding | Defaults to testnet-style values in the updated example |
| `MONIKER` | node / seed-node scaffolding | Human-readable node name |
| `MINIMUM_GAS_PRICES` | node scaffolding | Passed into the node container |
| `PRUNING` | node scaffolding | Passed into the node container |
| `INDEXER` | node scaffolding | Passed into the node container |
| `DB_USER` | postgres + compose-generated URLs | Shared Compose credential input |
| `DB_PASSWORD` | postgres + compose-generated URLs | Shared Compose credential input |
| `DB_NAME` | postgres + health checks | Shared Compose database name |
| `INDEXER_START_HEIGHT` | indexer scaffold | Compose name differs from API runtime `INDEXER_START_BLOCK` |
| `INDEXER_BATCH_SIZE` | indexer scaffold | Compose-only in this snapshot |
| `GRAFANA_USER` | grafana scaffold | Grafana bootstrap user |
| `GRAFANA_PASSWORD` | grafana scaffold | Grafana bootstrap password |
| `GRAFANA_ROOT_URL` | grafana scaffold | Grafana external URL |

## 5. Important Caveats

- `REDIS_URL` is still passed through parts of the Compose scaffold, but the current `backend/api/src/services/CacheService.ts` implementation is in-memory.
- `GRPC_URL` appears in Compose scaffolding but is not part of the API config contract enforced by `backend/api/src/config/index.ts`.
- Protected ops endpoints require bearer JWTs, but the current route surface does not expose a token issuance route.
- `backend/infra/docker-compose.yml` references additional files and directories that are not checked in, including `backend/api/Dockerfile.indexer`.

## 6. Production Hygiene Rules Already Enforced In Code

When `NODE_ENV=production`, API startup refuses to run with:

- missing explicit `RPC_URL`
- missing `DATABASE_URL`
- development JWT secrets
- wildcard `CORS_ORIGINS`
- `ALLOW_MOCK_SIGNATURES=true`
- `INDEXER_ENABLED=true` without explicit indexer RPC/WebSocket URLs and all contract addresses

Environment validation also rejects malformed URLs, malformed or zero EVM addresses,
and reconciliation thresholds where the critical exchange-rate threshold is not
greater than the warning threshold.

The `/v1/auth` routes persist nonce and refresh-token rotation state in the
`AuthNonce` and `AuthRefreshSession` database tables when `DATABASE_URL` is set.
Apply the matching Prisma migration before enabling production traffic.

Treat these checks as the baseline production contract, not a complete production
hardening program.
