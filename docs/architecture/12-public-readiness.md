# Track 12: Documentation & Public Readiness

## Overview

This document outlines the documentation deliverables, deployment checklist, and public readiness requirements for Cruzible's mainnet launch.

---

## 1. Documentation Deliverables

### 1.1 Architecture Documentation (Completed)

| Document | Status | Location |
|----------|--------|----------|
| Storage & Oracle Scoping | Done | `docs/architecture/09-storage-oracle-scoping.md` |
| Security Trust Model & Threat Model | Done | `docs/architecture/10-security-trust-model.md` |
| Benchmarking & SLOs | Done | `docs/architecture/11-benchmarking-slos.md` |
| Public Readiness (this doc) | Done | `docs/architecture/12-public-readiness.md` |

### 1.2 API Documentation

| Item | Status | Tool |
|------|--------|------|
| REST API OpenAPI spec | Partial (swagger.ts exists) | swagger-jsdoc |
| WebSocket event docs | Needed | Manual |
| Error code reference | Needed | From ApiError |
| Rate limit documentation | Needed | From rateLimiter |
| Authentication flow | Partial (auth service exists) | Manual |

### 1.3 SDK Documentation

| SDK | API Docs | Examples | Conformance Tests |
|-----|----------|----------|-------------------|
| TypeScript | Types exported | `src/` | `test/conformance.test.ts` |
| Python | Docstrings | `examples/` | `tests/test_conformance.py` |
| Go (keeper) | GoDoc comments | Benchmark tests | Keeper unit tests |
| Rust (TEE) | Inline docs | Integration tests | Cross-layer hash tests |

### 1.4 Operator Documentation

| Item | Priority | Status |
|------|----------|--------|
| Validator onboarding guide | P0 | Needed |
| TEE enclave setup (SGX) | P0 | Needed |
| TEE enclave setup (Nitro) | P0 | Needed |
| Relayer deployment guide | P0 | Needed |
| Emergency procedures runbook | P0 | Covered in Track 10 |
| Monitoring setup guide | P1 | Covered in Track 11 |

---

## 2. Pre-Launch Checklist

### 2.1 Smart Contracts

- [ ] All contracts deployed to testnet
- [ ] External audit completed (2 independent auditors recommended)
- [ ] Invariant/fuzz tests passing (Track 1)
- [ ] Gas optimization verified against budgets (Track 11)
- [ ] Timelock controller deployed and configured
- [ ] Proxy upgrade pattern tested
- [ ] Emergency pause tested on testnet
- [ ] Contract verification on block explorer

### 2.2 Cosmos Module

- [ ] Keeper unit tests passing (91+ tests)
- [ ] Benchmarks baseline established
- [ ] Emergency pause mechanism verified (Track 2)
- [ ] Circuit breaker tested with realistic thresholds
- [ ] TEE attestation verification tested for all platforms
- [ ] Validator selection flow end-to-end tested
- [ ] Genesis state initialization tested
- [ ] State migration tested (for future upgrades)

### 2.3 Backend

- [ ] API hardening complete (Track 6)
- [ ] Reconciliation scheduler deployed (Track 7)
- [ ] Alert webhook configured
- [ ] Rate limiting tuned for expected traffic
- [ ] Database migrations applied
- [ ] Index creation for high-traffic queries
- [ ] Redis deployed for production caching
- [ ] Sentry error tracking configured
- [ ] Health check endpoint monitored

### 2.4 Frontend

- [ ] Wallet integration tested with MetaMask, WalletConnect, Coinbase (Track 4)
- [ ] Real contract interactions verified on testnet
- [ ] Error states handled (wallet disconnect, tx rejection, network error)
- [ ] Mobile responsive design verified
- [ ] Lighthouse scores > 90 for all pages
- [ ] CSP headers configured
- [ ] Analytics/telemetry integrated
- [ ] Terms of service page
- [ ] Privacy policy page

### 2.5 Infrastructure

- [ ] Multi-region deployment (at least 2 regions)
- [ ] CDN configured for static assets
- [ ] DDoS protection enabled
- [ ] SSL certificates (Let's Encrypt or managed)
- [ ] DNS configured with DNSSEC
- [ ] Monitoring dashboards deployed (Track 11)
- [ ] On-call rotation established
- [ ] Incident response channel (Discord/Slack)

### 2.6 Security

- [ ] External smart contract audit report published
- [ ] Bug bounty program launched (Immunefi recommended)
- [ ] Penetration test completed on API
- [ ] CORS origins restricted to production domains
- [ ] JWT secrets rotated from development values
- [ ] API keys provisioned for partners
- [ ] OFAC screening integration (for large stakes)

---

## 3. Launch Sequence

### Phase 1: Private Testnet (Week 1-2)
- Deploy all contracts to private testnet
- Onboard 10-20 validators
- Run end-to-end staking flow
- Verify TEE attestation across platforms
- Load test with synthetic traffic

### Phase 2: Public Testnet (Week 3-4)
- Open testnet to public
- Bug bounty on testnet contracts
- Community validator onboarding
- SDK integration testing by partners
- Documentation review by community

### Phase 3: Mainnet Soft Launch (Week 5-6)
- Deploy to mainnet with deposit cap (e.g., 10M AETHEL)
- Whitelist initial validator set
- Monitor for 48 hours before removing cap
- Gradual cap increases (10M → 50M → 100M → unlimited)

### Phase 4: Full Launch (Week 7+)
- Remove deposit caps
- Enable circuit breaker with production thresholds
- Open validator onboarding
- Publish audit reports
- Launch bug bounty on mainnet

---

## 4. Post-Launch Monitoring

### First 24 Hours
- 15-minute reconciliation checks
- Manual review of every vault state change
- Core team on-call 24/7
- Real-time TVL and exchange rate monitoring

### First Week
- Daily reconciliation summary
- Review all circuit breaker near-misses
- Monitor validator telemetry freshness
- Track gas costs against budgets

### Ongoing
- Weekly performance reviews
- Monthly security reviews
- Quarterly audit refreshes
- Continuous benchmark regression testing

---

## 5. Communication Plan

| Channel | Purpose | Frequency |
|---------|---------|-----------|
| Discord | Community support, announcements | Real-time |
| Twitter/X | Launch announcements, milestones | As needed |
| Blog/Medium | Technical deep dives, audit reports | Weekly pre-launch, monthly post |
| GitHub | Release notes, changelogs | Per release |
| Email | Critical security notices | Emergency only |

---

## 6. Rollback Plan

If a critical issue is discovered post-launch:

1. **Immediate**: Trigger `PauseVault` to halt all operations
2. **Assess**: Determine if funds are at risk
3. **Communicate**: Notify community via Discord + Twitter within 1 hour
4. **Fix**: Deploy contract upgrade via timelock (24h delay) or keeper governance proposal
5. **Verify**: Run full test suite + reconciliation on the fix
6. **Resume**: `UnpauseVault` after fix is deployed and verified
7. **Report**: Publish post-mortem within 72 hours
