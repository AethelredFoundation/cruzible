# Track 11: Benchmarking & Service Level Objectives (SLOs)

## Overview

This document defines performance benchmarks, SLO targets, and monitoring requirements for the Cruzible liquid staking protocol across all layers.

---

## 1. Service Level Objectives

### 1.1 Frontend (dApp)

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| First Contentful Paint (FCP) | < 1.5s | Lighthouse CI | > 2.5s |
| Largest Contentful Paint (LCP) | < 2.5s | Lighthouse CI | > 4.0s |
| Cumulative Layout Shift (CLS) | < 0.1 | Lighthouse CI | > 0.25 |
| Time to Interactive (TTI) | < 3.5s | Lighthouse CI | > 5.0s |
| Bundle size (gzipped) | < 300 KB | Webpack analyzer | > 400 KB |
| Wallet connect success rate | > 99% | Custom telemetry | < 95% |
| Page load success rate | > 99.9% | Uptime monitoring | < 99.5% |

### 1.2 Backend API

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| p50 response time | < 50ms | Prometheus histogram | > 100ms |
| p95 response time | < 200ms | Prometheus histogram | > 500ms |
| p99 response time | < 500ms | Prometheus histogram | > 1s |
| Error rate (5xx) | < 0.1% | Prometheus counter | > 1% |
| Request throughput | > 1000 rps | Prometheus gauge | < 500 rps |
| Availability | > 99.9% | Uptime monitor | < 99.5% |
| Cache hit rate | > 80% | CacheService metrics | < 60% |

### 1.3 Blockchain (Cosmos SDK)

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| Block time | ~6s | Chain metrics | > 10s |
| Transaction finality | < 7s | Block confirmation | > 15s |
| Stake transaction gas | < 200K gas | Gas profiling | > 300K |
| Unstake transaction gas | < 250K gas | Gas profiling | > 400K |
| Validator selection gas | < 500K gas | Gas profiling | > 1M |
| Epoch advancement latency | < 30s after epoch end | Monitoring | > 5 minutes |

### 1.4 EVM Contracts

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| Stake gas cost | < 150K gas | Foundry gas report | > 200K |
| Unstake gas cost | < 120K gas | Foundry gas report | > 180K |
| Withdraw gas cost | < 80K gas | Foundry gas report | > 120K |
| ClaimRewards gas cost | < 100K gas (per claim) | Foundry gas report | > 150K |
| ApplyValidatorSelection gas | < 500K (200 validators) | Foundry gas report | > 800K |

### 1.5 TEE Worker

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| Validator selection latency | < 2s | TEE service metrics | > 5s |
| Attestation generation time | < 500ms | TEE service metrics | > 1s |
| Attestation verification time | < 100ms | Keeper benchmarks | > 500ms |
| Enclave boot time | < 10s | Deployment metrics | > 30s |

### 1.6 Indexer

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| Block indexing lag | < 3 blocks | IndexerService metrics | > 10 blocks |
| Event processing latency | < 1s per block | Prometheus histogram | > 5s |
| Reorg detection accuracy | 100% | Integration tests | Any miss |
| Database write throughput | > 100 events/s | Prisma metrics | < 50 events/s |

---

## 2. Benchmarking Infrastructure

### 2.1 Keeper Benchmarks (Go)

```bash
# Run keeper benchmarks
cd /path/to/aethelred
go test ./x/vault/keeper/ -bench=. -benchmem -count=5
```

Recommended benchmark functions to add:

```go
func BenchmarkStake(b *testing.B) {
    k, ctx := setupKeeper(b)
    // Setup validator
    for i := 0; i < b.N; i++ {
        k.Stake(ctx, fmt.Sprintf("addr%d", i), 100_000_000, "val1", 0)
    }
}

func BenchmarkUnstake(b *testing.B) { ... }
func BenchmarkComputeValidatorSetHash(b *testing.B) { ... }
func BenchmarkVerifyAttestation(b *testing.B) { ... }
func BenchmarkBuildValidatorSelectionRequest(b *testing.B) { ... }
```

### 2.2 API Load Testing

```bash
# Using autocannon (already in devDependencies)
npx autocannon -c 100 -d 30 http://localhost:3001/health
npx autocannon -c 50 -d 30 http://localhost:3001/v1/blocks
npx autocannon -c 50 -d 30 http://localhost:3001/v1/reconciliation/live
```

Target results:
- `/health`: > 10,000 rps, p99 < 10ms
- `/v1/blocks`: > 2,000 rps, p99 < 100ms
- `/v1/reconciliation/live`: > 500 rps, p99 < 500ms

### 2.3 Smart Contract Gas Profiling

```bash
# Using Foundry
cd contracts/
forge test --gas-report
forge snapshot  # Creates .gas-snapshot for regression detection
```

### 2.4 Frontend Performance Testing

```bash
# Lighthouse CI
npx lighthouse http://localhost:3000/vault --output=json --output-path=lighthouse-vault.json
npx lighthouse http://localhost:3000/ --output=json --output-path=lighthouse-home.json
```

Integration with CI:
```yaml
# .github/workflows/lighthouse.yml
- name: Lighthouse CI
  uses: treosh/lighthouse-ci-action@v10
  with:
    urls: |
      http://localhost:3000/
      http://localhost:3000/vault
    budgetPath: ./lighthouse-budget.json
```

---

## 3. Monitoring Stack

### 3.1 Recommended Stack

| Component | Tool | Purpose |
|-----------|------|---------|
| Metrics collection | Prometheus | Time-series metrics |
| Metrics visualization | Grafana | Dashboards, alerting |
| Log aggregation | Loki or ELK | Structured log search |
| Uptime monitoring | UptimeRobot or Pingdom | External availability |
| Error tracking | Sentry | Runtime error capture |
| APM | Datadog or New Relic | Full-stack observability |

### 3.2 Key Dashboards

1. **Protocol Health Dashboard**
   - TVL (total pooled AETHEL)
   - Exchange rate over time
   - Active staker count
   - Pending withdrawals
   - Epoch progression
   - Circuit breaker status

2. **API Performance Dashboard**
   - Request rate by endpoint
   - Response time percentiles (p50, p95, p99)
   - Error rate by status code
   - Cache hit/miss ratio
   - Active connections

3. **Indexer Dashboard**
   - Block lag (head vs indexed)
   - Events processed per minute
   - Reorg events
   - Database write latency
   - WebSocket connection status

4. **Validator Health Dashboard**
   - Active validator count
   - Telemetry freshness distribution
   - Slash events
   - TEE attestation success rate
   - Validator selection frequency

---

## 4. Performance Budget

### 4.1 Frontend Bundle Budget

| Chunk | Max Size (gzipped) | Current Estimate |
|-------|-------------------|------------------|
| vendor (node_modules) | 150 KB | ~120 KB |
| common (shared code) | 50 KB | ~30 KB |
| recharts | 80 KB | ~70 KB |
| page chunks (each) | 30 KB | ~15-25 KB |
| **Total initial load** | **200 KB** | **~150 KB** |

### 4.2 API Response Size Budget

| Endpoint | Max Response Size | Pagination |
|----------|------------------|------------|
| GET /v1/blocks | 50 KB (100 blocks) | limit=100, offset |
| GET /v1/blocks/:height | 5 KB | N/A |
| GET /v1/jobs | 100 KB (50 jobs) | limit=50, offset |
| GET /v1/reconciliation/live | 200 KB (200 validators) | N/A |
| GET /v1/alerts | 20 KB (50 alerts) | limit=50, offset |

---

## 5. SLO Alerting Rules

### 5.1 Prometheus Alert Rules

```yaml
groups:
  - name: cruzible-slos
    rules:
      # API latency SLO breach
      - alert: HighAPILatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "p95 API latency exceeds 500ms"

      # Error rate SLO breach
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "5xx error rate exceeds 1%"

      # Indexer lag
      - alert: IndexerLagging
        expr: cruzible_indexer_block_lag > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Indexer is more than 10 blocks behind"

      # Circuit breaker tripped
      - alert: CircuitBreakerTripped
        expr: cruzible_vault_paused == 1
        labels:
          severity: critical
        annotations:
          summary: "Vault circuit breaker has been tripped"

      # Exchange rate anomaly
      - alert: ExchangeRateAnomaly
        expr: abs(cruzible_exchange_rate - cruzible_exchange_rate offset 1h) / cruzible_exchange_rate > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Exchange rate changed more than 5% in 1 hour"
```

---

## 6. Continuous Performance Regression

### 6.1 CI Integration

Every PR should run:
1. `forge snapshot --check` — Contract gas regression
2. `go test -bench=. -benchmem` — Keeper performance regression
3. `npx autocannon` — API throughput regression (against staging)
4. Lighthouse CI — Frontend performance regression

### 6.2 Performance Gate

PRs are blocked if:
- Any gas cost increases > 10%
- Keeper benchmark regresses > 20%
- Lighthouse score drops below 90
- API p95 latency increases > 50ms
