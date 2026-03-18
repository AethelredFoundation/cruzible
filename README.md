<div align="center">
  <img src="README-logo.png" alt="Cruzible" width="200" />
  <h1>Cruzible</h1>
  <p><strong>TEE-verified liquid staking vault for the Aethelred sovereign L1</strong></p>
  <p>
    <a href="https://github.com/aethelred-foundation/cruzible/actions/workflows/ci-cd.yml"><img src="https://img.shields.io/github/actions/workflow/status/aethelred-foundation/cruzible/ci-cd.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
    <a href="https://codecov.io/gh/aethelred-foundation/cruzible"><img src="https://img.shields.io/codecov/c/github/aethelred-foundation/cruzible?style=flat-square&label=coverage" alt="Coverage"></a>
    <a href="backend/contracts/SECURITY_AUDIT.md"><img src="https://img.shields.io/badge/audit-120_attack_analysis-informational?style=flat-square" alt="Audit"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License"></a>
  </p>
  <p>
    <a href="https://cruzible.aethelred.io">App</a> &middot;
    <a href="https://docs.aethelred.io">Docs</a> &middot;
    <a href="https://api.aethelred.io/docs">API Reference</a> &middot;
    <a href="https://discord.gg/aethelred">Discord</a> &middot;
    <a href="docs/architecture/12-public-readiness.md">Public Readiness</a>
  </p>
</div>

---

## Overview

Cruzible is a full-stack liquid staking application built on **Aethelred** — a sovereign Layer 1 optimised for verifiable AI computation. Users can stake AETHEL, receive stAETHEL as a liquid receipt token, explore on-chain activity, monitor validators, and submit TEE-attested AI inference jobs — all from a single interface.

> **Status** &mdash; Pre-mainnet. See the [public readiness checklist](docs/architecture/12-public-readiness.md) for launch progress.

---

## Features

<table>
<tr>
<td width="50%">

**Blockchain Explorer**
- Real-time block tracking with WebSocket feeds
- Full transaction history with advanced filtering
- Validator performance and uptime monitoring
- Network health metrics dashboard

</td>
<td width="50%">

**AI Job Verification**
- TEE-attested inference job submission
- Automatic validator assignment
- ZK proof, TEE attestation, and MPC proof verification
- Automated payment settlement

</td>
</tr>
<tr>
<td width="50%">

**Liquid Staking (stAETHEL)**
- Stake AETHEL and earn rewards with full liquidity
- Trade stAETHEL without unbonding periods
- Manual or auto-delegated validator selection
- Compound or claim rewards on demand

</td>
<td width="50%">

**Governance** *(preview — not yet deployed on-chain)*
- Protocol upgrade proposals
- On-chain voting and delegation
- Treasury and community fund management

</td>
</tr>
</table>

---

## Architecture

```mermaid
graph TB
    subgraph Frontend
        A[Next.js 14 / React 18<br/>Tailwind CSS / Wagmi]
    end

    subgraph API Gateway
        B[Express / TypeScript<br/>WebSocket / JWT Auth]
    end

    subgraph Blockchain Node
        C[Rust / Tendermint<br/>HotStuff BFT]
    end

    subgraph Storage
        D[(PostgreSQL 16<br/>Prisma ORM)]
        E[(Redis 7<br/>Cache & Pub/Sub)]
    end

    subgraph Smart Contracts
        F[CosmWasm<br/>AI Job Manager / AethelVault<br/>Governance / Seal Manager<br/>Model Registry / CW20 Staking]
    end

    A <-->|REST + WS| B
    B <-->|gRPC| C
    B --- D
    B --- E
    C --- F
```

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 20.0.0 |
| Rust | >= 1.75.0 |
| Docker + Compose | latest |
| PostgreSQL | >= 16 |
| Redis | >= 7 |

### Installation

```bash
# Clone
git clone https://github.com/aethelred-foundation/cruzible.git
cd cruzible

# Install dependencies
npm ci

# Configure
cp .env.example .env
# Edit .env with your configuration

# Start infrastructure
docker-compose -f backend/infra/docker-compose.yml up -d

# Run database migrations
cd backend/api && npx prisma migrate dev && cd ../..

# Start development servers
npm run dev           # Frontend  — http://localhost:3000
npm run dev:api       # API       — http://localhost:3001
```

<details>
<summary>Environment variables</summary>

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/aethelred

# Redis
REDIS_URL=redis://localhost:6379

# Blockchain
RPC_URL=http://localhost:26657
GRPC_URL=http://localhost:9090

# Security
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# External Services
SENTRY_DSN=your-sentry-dsn
ANALYTICS_ID=your-analytics-id
```

</details>

---

## Project Structure

```
cruzible/
├── src/                            # Next.js frontend
│   ├── components/                 # React components
│   ├── contexts/                   # Global state (AppContext)
│   ├── hooks/                      # Custom React hooks
│   ├── lib/                        # Utilities and constants
│   ├── pages/                      # Routes — blocks, validators, jobs, vault, governance
│   ├── __tests__/                  # Jest + RTL test suites
│   └── mocks/                      # MSW request handlers
│
├── backend/
│   ├── api/                        # Express API gateway (TypeScript)
│   │   ├── src/                    # Routes, services, middleware, auth
│   │   ├── prisma/                 # Database schema and migrations
│   │   └── tests/                  # API integration tests
│   ├── contracts/                  # CosmWasm smart contracts (Rust)
│   │   └── contracts/              # ai_job_manager, vault, governance, seal_manager, model_registry, cw20_staking
│   ├── node/                       # Blockchain node (Rust / Tendermint / HotStuff BFT)
│   └── infra/                      # Docker Compose and K8s configs
│
├── sdk/                            # Client SDKs (TypeScript, Python)
├── docs/                           # Architecture docs and ops runbook
├── specs/                          # Protocol specifications
├── k8s/                            # Kubernetes manifests
├── .github/workflows/ci-cd.yml    # CI/CD pipeline
└── .env.example                    # Environment template
```

---

## Testing

```bash
# Frontend — unit and component tests
npm test
npm run test:coverage
npm run test:watch

# Integration tests
docker-compose -f docker-compose.test.yml up -d
npm run test:integration

# E2E tests (Playwright)
npx playwright install
npm run test:e2e

# Smart contracts
cd backend/contracts
cargo test --all
cargo tarpaulin --all          # coverage
```

---

## Security

**Audit reports:**
[120-Attack Analysis](backend/contracts/SECURITY_AUDIT.md) ·
[Compliance Report](backend/contracts/SECURITY_COMPLIANCE_REPORT.md) ·
[Code Review](CODE_REVIEW_REPORT.md)

**Application layer:**
JWT + refresh-token auth, RBAC, Zod input validation, per-endpoint rate limiting, CORS, Helmet security headers, parameterised queries (Prisma), XSS sanitisation.

**Smart contract layer:**
Reentrancy guard (checks-effects-interactions), checked arithmetic, role-based access control, emergency pause mechanism, solvency and share-conservation invariants.

---

## Performance

| Metric | Target | Current |
|--------|--------|---------|
| First Contentful Paint | < 1.5 s | 0.9 s |
| Largest Contentful Paint | < 2.5 s | 1.8 s |
| Time to Interactive | < 3.5 s | 2.2 s |
| API Response Time (p95) | < 200 ms | 120 ms |
| Contract Gas — stake | < 100 k | 80 k |

Optimisations: code splitting, Next.js image optimisation, Redis response caching, CDN edge delivery, Gzip/Brotli compression, database indexing.

---

## Development

```bash
npm run lint && npm run lint:fix    # ESLint
npm run format                      # Prettier
npm run type-check                  # TypeScript strict mode
npm run validate                    # All checks
```

Pre-commit hooks (Husky) run ESLint, Prettier, TypeScript checks, and unit tests on changed files.

### CI/CD Pipeline

**On every PR:** security audit, lint + format, unit tests (frontend, backend, contracts), integration tests, E2E tests, build verification.

**On merge to main:** Docker build, push to registry, deploy to staging, smoke tests, deploy to production.

---

## API

### REST

```bash
GET  /v1/blocks?limit=10
GET  /v1/blocks/:height
GET  /v1/transactions?sender=aethelred1...
GET  /v1/validators/:address
```

### WebSocket

```javascript
const ws = new WebSocket('wss://api.aethelred.io/ws');

ws.send(JSON.stringify({ method: 'subscribe', channel: 'blocks' }));
ws.send(JSON.stringify({ method: 'subscribe', channel: 'transactions', filter: { address: 'aethelred1...' } }));
```

Full reference: [api.aethelred.io/docs](https://api.aethelred.io/docs)

---

## Contributing

We welcome contributions. Please see the [Contributing Guide](CONTRIBUTING.md) before opening a PR.

1. Fork the repository
2. Create a feature branch — `git checkout -b feature/my-feature`
3. Run `npm run validate`
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
5. Open a Pull Request

---

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

[CosmWasm](https://cosmwasm.com/) · [Tendermint](https://tendermint.com/) · [Next.js](https://nextjs.org/) · [Tailwind CSS](https://tailwindcss.com/)

---

<p align="center">
  <a href="https://docs.aethelred.io">Docs</a> &middot;
  <a href="https://discord.gg/aethelred">Discord</a> &middot;
  <a href="https://twitter.com/aethelred">Twitter</a> &middot;
  <a href="mailto:support@aethelred.io">Support</a>
</p>
<p align="center">
  Copyright &copy; 2024–2026 Aethelred Foundation
</p>
