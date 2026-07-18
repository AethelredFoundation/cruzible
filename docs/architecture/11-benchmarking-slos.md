# Benchmarking and Service Objectives

> Workspace-aligned performance notes for the current Cruzible snapshot.
> Last reconciled on 2026-06-26.

## 1. Scope

This document only covers measurement paths that are backed by code or scripts present in this repository today. Where deployment automation is still incomplete, treat live-environment targets as operator goals while keeping the checked-in gates green before release.

## 2. What Can Be Measured From This Repo Now

| Area                            | Available measurement path                 | Backing artifact                                          |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Frontend build health           | `npm run build`                            | root `package.json`                                       |
| Frontend bundle analysis        | `npm run analyze`                          | root `package.json`                                       |
| Frontend journey budgets        | `npm run performance:journey`              | `e2e/performance-budget.spec.ts`                          |
| Frontend test coverage          | `npm run test:coverage`                    | root `package.json`                                       |
| API liveness benchmark gate     | `npm run performance:api`                  | `backend/api/scripts/benchmark-health.mjs`                |
| API readiness                   | `GET /health/live` and `GET /health/ready` | `backend/api/src/routes/health.ts`                        |
| API route documentation         | `GET /docs`                                | `backend/api/src/config/swagger.ts` and route annotations |
| Contract test coverage baseline | `cd backend/contracts && cargo test --all` | `backend/contracts`                                       |

## 3. Service Objectives

### Frontend

| Metric                                                             | Target                                                              | How to measure                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------- |
| Production build succeeds                                          | 100%                                                                | `npm run build`               |
| Landing and vault pages remain usable on desktop/mobile            | automated smoke plus page review                                    | `npm run test:e2e`            |
| Critical launch routes stay within synthetic journey budgets       | route-specific DCL, load, FCP, transfer, and resource-count budgets | `npm run performance:journey` |
| Initial page performance stays within a normal modern app envelope | LCP under 2.5s when tested on representative infra                  | Lighthouse/staging testing    |
| Regressions in bundle growth are investigated                      | analyze on meaningful changes                                       | `npm run analyze`             |

### API

| Metric                                                              | Target                                         | How to measure                        |
| ------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| `/health/live` remains fast enough for liveness probes              | p95 under 250ms on representative infra        | `npm run benchmark -- --url <staging-api>/health/live` |
| API benchmark thresholds remain release-gated                       | checked-in p95, mean, max, timeout, and success-rate thresholds parse and fail closed | `npm run performance:api` |
| `/health/ready` only returns 200 when core dependencies are healthy | 100% correctness                               | direct curl / monitoring checks       |
| Public route surface remains documented                             | `/docs` renders and matches route annotations  | local run of API                      |
| Global rate limiter behaves predictably                             | default 120 requests per 60s unless overridden | automated tests + env review          |

### Operational signals already encoded in code

| Signal                | Warning threshold             | Critical threshold                  | Source                                                |
| --------------------- | ----------------------------- | ----------------------------------- | ----------------------------------------------------- |
| Indexer lag           | `>100` blocks degrades health | `>500` blocks makes service unready | `backend/api/src/routes/health.ts`                    |
| Reconciliation status | `WARNING` degrades health     | `CRITICAL` makes service unready    | `backend/api/src/routes/health.ts`                    |
| Same-block exchange-rate mismatch | `1%` warning by default | `5%` critical by default | `backend/api/src/services/ReconciliationScheduler.ts` |
| Same-block vault TVL mismatch | n/a | `2%` threshold by default | `backend/api/src/services/ReconciliationScheduler.ts` |

## 4. Recommended Measurement Commands

```bash
# Frontend
npm run build
npm run performance:journey
npm run analyze
npm run test:coverage

# API
npm run performance:api
cd backend/api
npm run build
npm run test:coverage
npm run benchmark:check
npm run benchmark -- --url https://api.testnet.aethelred.org/health/live

# Runtime probes
curl -s http://localhost:3001/health | jq
curl -s http://localhost:3001/health/ready | jq

# Contracts
cd ../contracts
cargo test --all
```

## 5. Notes For Operators

- Full `/health` is a token-gated diagnostic endpoint in production; liveness and readiness automation should use `/health/live` and `/health/ready`.
- The API benchmark emits machine-readable `cruzible.api_benchmark_gate.v1` JSON evidence. CI uses `benchmark:check` so threshold/config regressions fail without depending on an external staging URL; operators should run live mode against staging or release-candidate infrastructure before traffic promotion.
- Runtime frontend pages are expected to fail closed or render readiness-gated empty states when live APIs are unavailable; checked-in MSW handlers are test-only and guarded from production imports.
- The API exposes Prometheus-compatible process and HTTP metrics at `/metrics`; the Compose monitoring baseline now includes Prometheus scrape config, alert rules, and a Grafana dashboard provider that use the operational token rather than exposing metrics anonymously.
- `CacheService` uses Redis when `REDIS_URL` is configured and production startup requires Redis. Alert history is database-backed when `DATABASE_URL` is configured.

## 6. Known Measurement Gaps

- Synthetic frontend journey budgets and the API benchmark gate are checked in for critical launch paths; Lighthouse, real-user monitoring, and live API latency thresholds still need staging calibration.
- The checked-in Prometheus/Grafana bundle is a baseline; it still needs staging calibration against real production traffic, alert routing, and incident-response ownership.
- The repository does not currently include a complete turnkey deployment that can be treated as the canonical performance environment.
