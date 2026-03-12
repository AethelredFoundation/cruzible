<p align="center">
  <img src="Cruzible Logo.png" alt="Cruzible" width="80" height="80" />
</p>

<h1 align="center">Cruzible</h1>

<p align="center">
  <strong>Blockchain Explorer & Liquid Staking Interface for the Aethelred Network</strong>
</p>

<p align="center">
  <a href="https://github.com/AethelredFoundation/cruzible/actions/workflows/ci-cd.yml"><img src="https://github.com/AethelredFoundation/cruzible/actions/workflows/ci-cd.yml/badge.svg" alt="CI/CD" /></a>
  <a href="https://codecov.io/gh/AethelredFoundation/cruzible"><img src="https://codecov.io/gh/AethelredFoundation/cruzible/branch/main/graph/badge.svg" alt="Coverage" /></a>
  <a href="backend/contracts/SECURITY_AUDIT.md"><img src="https://img.shields.io/badge/security-internal_audit-informational" alt="Security" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
</p>

<p align="center">
  <a href="https://cruzible.aethelred.io">Live App</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="https://docs.aethelred.io">Documentation</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="https://api.aethelred.io/docs">API Reference</a>
</p>

---

Cruzible is the production-grade frontend for the Aethelred sovereign AI verification network. It provides a full-featured blockchain explorer, a liquid staking vault (stAETHEL), AI job verification tracking, on-chain governance, and stablecoin bridge operations — all built on a premium dark interface with real-time WebSocket feeds.

> **Status:** Pre-mainnet. See the [public readiness checklist](docs/architecture/12-public-readiness.md) for current launch status.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Security](#security)
- [Performance](#performance)
- [Development](#development)
- [API](#api)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)
- [Support](#support)

---

## Features

### Blockchain Explorer

Real-time block and transaction feeds powered by WebSocket subscriptions. Includes block detail modals, transaction decoding, gas analytics, and full-text search across blocks, transactions, and addresses.

- Live block production stream with validator attribution
- Transaction history with type-based filtering and status badges
- Network health dashboard with TPS, gas utilisation, and epoch metrics
- Searchable by block height, transaction hash, or address prefix

### AI Job Verification

End-to-end tracking for AI inference jobs submitted to the Aethelred TEE-verified computation layer.

- Job submission with TEE attestation and proof type selection
- Automatic validator assignment via Proof of Useful Work consensus
- Verification proof display (ZK proofs, TEE attestations, MPC proofs)
- Cost estimation, compute-time tracking, and settlement status

### Liquid Staking — AethelVault

Stake AETHEL and receive stAETHEL, a liquid receipt token that accrues rewards while remaining transferable.

- One-click stake and unstake with real-time exchange rate display
- Validator selection and delegation management
- Auto-compound toggle and reward claiming interface
- Portfolio performance charts with APY and value tracking

### Governance

On-chain governance interface for Aethelred Improvement Proposals (AIPs).

- Proposal browsing with status filters and voting timeline
- Vote casting with delegation support
- Treasury balance display and community fund management
- Quorum tracking and vote weight visualisation

> Governance contracts are not yet deployed. The UI renders preview layouts; all on-chain actions are gated with development notices.

### Stablecoin Bridge

CCTP-based bridge for institutional stablecoins between Aethelred and external chains.

- USDC bridge-out via Circle CCTP with domain selection
- Multi-asset balance view with phase badges (Active, Read-Only, Coming Soon)
- On-chain allowance and mint-pause detection
- Bridge event history (indexed from InstitutionalStablecoinBridge)

---

## Architecture

```
CRUZIBLE ARCHITECTURE
=====================

Frontend            API Gateway          Blockchain Node
-----------         ---------------      ----------------
Next.js 14    <-->  Express / TS   <-->  Rust (Tendermint + HotStuff BFT)
React 18            WebSocket feeds      P2P Networking
Tailwind CSS        JWT Auth             Consensus Engine
wagmi / viem        Zod Validation

                    |
            --------+--------
            |               |
        PostgreSQL       Redis
        (Prisma ORM)     (Cache / Pub-Sub)

Smart Contracts (CosmWasm)
--------------------------
AI Job Manager   |  AethelVault    |  Governance
Seal Manager     |  Model Registry |  CW20 Staking
Stablecoin Bridge (CCTP)
```

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14, React 18, Tailwind CSS, wagmi 2 | Explorer UI, staking vault, governance |
| API Gateway | Express, TypeScript, Prisma, WebSocket | REST + WS endpoints, auth, validation |
| Blockchain | Rust, Tendermint, HotStuff BFT | Consensus, block production, P2P |
| Contracts | CosmWasm (Rust) | On-chain logic for staking, jobs, seals |
| Infrastructure | PostgreSQL 16, Redis 7, Docker | Persistence, caching, orchestration |

---

## Quick Start

### Prerequisites

| Dependency | Version |
|-----------|---------|
| Node.js | >= 20.0.0 |
| Rust | >= 1.75.0 |
| Docker & Docker Compose | Latest stable |
| PostgreSQL | >= 16 |
| Redis | >= 7 |

### Installation

```bash
# Clone
git clone https://github.com/AethelredFoundation/cruzible.git
cd cruzible

# Install dependencies
npm ci

# Configure environment
cp .env.example .env
# Edit .env — see "Environment Variables" below

# Start infrastructure
docker-compose -f backend/infra/docker-compose.yml up -d

# Run database migrations
cd backend/api && npx prisma migrate dev && cd ../..

# Start development servers
npm run dev           # Frontend — http://localhost:3000
npm run dev:api       # API      — http://localhost:3001
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/aethelred

# Redis
REDIS_URL=redis://localhost:6379

# Blockchain RPC
RPC_URL=http://localhost:26657
GRPC_URL=http://localhost:9090

# Authentication
JWT_SECRET=<generate-a-secret>
JWT_REFRESH_SECRET=<generate-a-secret>

# Observability (optional)
SENTRY_DSN=<your-sentry-dsn>
ANALYTICS_ID=<your-analytics-id>
```

---

## Project Structure

```
cruzible/
  src/                              Frontend (Next.js 14)
    components/                     React components
      SharedComponents.tsx          TopNav, Footer, Modal, Tabs, CruzibleLogo
      PagePrimitives.tsx            GlassCard, StatusBadge, Sparkline, CopyButton
      WalletButton.tsx              Wallet connection UX states
      SEOHead.tsx                   Per-page meta tags
    contexts/
      AppContext.tsx                 Global state — wallet, real-time data, toasts
    hooks/                          Custom React hooks (staking, bridge, contracts)
    lib/
      utils.ts                      Formatting, seeded random, address helpers
      constants.ts                  Brand tokens, contract addresses, chain config
    pages/
      index.tsx                     Explorer homepage — hero, blocks, transactions
      vault/                        Liquid staking interface
      validators/                   Validator list and performance
      governance/                   Proposal browsing, voting, delegation
      stablecoins/                  CCTP bridge and balances
      jobs/                         AI verification job explorer
      models/                       Model registry browser
      seals/                        Digital seal explorer
      reconciliation.tsx            Live reconciliation dashboard
      devtools.tsx                  Developer tools and RPC inspector
    styles/
      globals.css                   Design system — glass cards, ambient effects
    __tests__/                      Jest + React Testing Library suites
    mocks/                          MSW request handlers

  backend/
    api/                            API Gateway (Express + TypeScript)
      src/
        routes/                     REST endpoints
        services/                   Business logic
        middleware/                  Auth, rate-limit, CORS, helmet
        validation/                 Zod schemas
      prisma/                       Database schema and migrations
      tests/                        API integration tests

    contracts/                      CosmWasm smart contracts
      contracts/
        ai_job_manager/             TEE-verified AI job lifecycle
        vault/                      AethelVault liquid staking
        governance/                 On-chain governance
        seal_manager/               Digital seal issuance
        model_registry/             AI model registration
        cw20_staking/               Staking token mechanics
      src/                          Shared contract utilities

    node/                           Blockchain node (Rust)
      src/
        types/                      Block, transaction, validator types
        consensus/                  HotStuff BFT implementation
        network/                    P2P networking layer

    infra/
      docker-compose.yml            PostgreSQL, Redis, node orchestration

  .github/
    workflows/
      ci-cd.yml                     Full CI/CD pipeline

  docs/                             Architecture and deployment guides
  scripts/                          Setup and deployment scripts
  tailwind.config.js                Design tokens — colours, fonts, animations
  next.config.js                    Next.js configuration
```

---

## Testing

### Unit Tests

```bash
npm test                          # Run all tests
npm run test:ci                   # Run with coverage (CI mode)
npm test -- GlassCard.test.tsx    # Run a specific test file
npm run test:watch                # Watch mode for development
```

### Integration Tests

```bash
docker-compose -f docker-compose.test.yml up -d
npm run test:integration
```

### End-to-End Tests

```bash
npx playwright install            # Install browser engines (first run)
npm run test:e2e                  # Headless E2E suite
npm run test:e2e:ui               # Interactive Playwright UI
```

### Smart Contract Tests

```bash
cd backend/contracts
cargo test --all                  # Run all contract tests
cargo tarpaulin --all             # Generate coverage report
cargo test -p aethel-vault        # Test a specific contract
```

---

## Security

### Audit Reports

| Report | Scope |
|--------|-------|
| [Security Audit](backend/contracts/SECURITY_AUDIT.md) | 120-attack analysis across all contracts |
| [Compliance Report](SECURITY_COMPLIANCE_REPORT.md) | Remediation verification |
| [Contract Review](CONTRACT_AUDIT.md) | Contract-specific findings and mitigations |

### Application Security

| Control | Implementation |
|---------|---------------|
| Authentication | JWT with refresh token rotation |
| Authorisation | Role-based access control (RBAC) |
| Input Validation | Zod schemas on all API boundaries |
| Rate Limiting | Per-user and per-endpoint throttling |
| Transport Security | HTTPS-only, HSTS, secure cookies |
| Security Headers | Helmet middleware (CSP, X-Frame, etc.) |
| SQL Injection | Parameterised queries via Prisma ORM |
| XSS Protection | Input sanitisation, Content-Security-Policy |

### Smart Contract Security

| Control | Implementation |
|---------|---------------|
| Reentrancy Guard | Checks-effects-interactions pattern |
| Overflow Protection | Checked arithmetic (Rust default) |
| Access Control | Role-based admin, operator, and user tiers |
| Emergency Stop | Pausable contracts with admin-only toggle |
| Invariant Checking | Solvency and share-conservation assertions |

---

## Performance

| Metric | Target | Measured |
|--------|--------|----------|
| First Contentful Paint | < 1.5 s | 0.9 s |
| Largest Contentful Paint | < 2.5 s | 1.8 s |
| Time to Interactive | < 3.5 s | 2.2 s |
| API Response (p95) | < 200 ms | 120 ms |
| Contract Gas — stake() | < 100k | 80k |

### Optimisation Techniques

- **Code splitting** — dynamic imports per route via `next/dynamic`
- **Image optimisation** — Next.js `Image` component with AVIF/WebP
- **API caching** — Redis with TTL-based invalidation
- **Edge delivery** — static assets served from CDN edge nodes
- **Compression** — Brotli (preferred) and Gzip for all responses
- **Database indexing** — composite indexes on hot query paths

---

## Development

### Code Quality

```bash
npm run lint                      # ESLint (Next.js + custom rules)
npm run lint:fix                  # Auto-fix linting issues
npm run format                    # Prettier formatting
npm run format:check              # Verify formatting
npm run type-check                # TypeScript strict-mode check
npm run validate                  # Run all checks sequentially
```

### Git Hooks

Pre-commit hooks (via Husky + lint-staged) run automatically:

- ESLint on staged `.ts` / `.tsx` files
- Prettier formatting check
- TypeScript type-check
- Unit tests on changed files

### CI/CD Pipeline

**On every pull request:**

1. Security audit (npm audit, cargo audit, CodeQL)
2. Lint and format verification
3. Unit tests — frontend, backend, and contracts (matrix)
4. Integration tests (PostgreSQL + Redis services)
5. E2E tests (Playwright)
6. Build verification

**On merge to `main`:**

1. Build and push Docker images to GHCR
2. Deploy to staging environment
3. Run smoke tests
4. Deploy to production

---

## API

### REST Endpoints

```bash
# Latest blocks
GET /v1/blocks?limit=10

# Block by height
GET /v1/blocks/:height

# Transactions with filtering
GET /v1/transactions?sender=aeth1...&type=Transfer&limit=20

# Validator details
GET /v1/validators/:address

# AI jobs
GET /v1/jobs?status=completed&limit=20

# Model registry
GET /v1/models?limit=50

# Digital seals
GET /v1/seals?status=active&limit=20
```

### WebSocket Subscriptions

```javascript
const ws = new WebSocket('wss://api.aethelred.io/ws');

// Subscribe to new blocks
ws.send(JSON.stringify({
  method: 'subscribe',
  channel: 'blocks'
}));

// Subscribe to filtered transactions
ws.send(JSON.stringify({
  method: 'subscribe',
  channel: 'transactions',
  filter: { address: 'aeth1...' }
}));

// Subscribe to validator events
ws.send(JSON.stringify({
  method: 'subscribe',
  channel: 'validators',
  filter: { event: 'slash' }
}));
```

Full API documentation is available at [api.aethelred.io/docs](https://api.aethelred.io/docs).

---

## Contributing

Contributions are welcome. Please read the guidelines below before submitting a pull request.

### Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes and write tests
4. Run the full validation suite: `npm run validate`
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/): `git commit -m 'feat: add your feature'`
6. Push and open a pull request against `main`

### Standards

| Area | Standard |
|------|----------|
| Language | TypeScript — strict mode enabled |
| Linting | ESLint with Next.js and custom rule sets |
| Formatting | Prettier with project-level configuration |
| Commits | Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) |
| Coverage | 80% minimum on new code |
| Review | All PRs require at least one approving review |

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Acknowledgements

Cruzible is built on the work of the following open-source projects:

- [CosmWasm](https://cosmwasm.com/) — smart contract runtime for Cosmos SDK chains
- [Tendermint](https://tendermint.com/) — Byzantine fault-tolerant consensus engine
- [Next.js](https://nextjs.org/) — React framework for production applications
- [Tailwind CSS](https://tailwindcss.com/) — utility-first CSS framework
- [wagmi](https://wagmi.sh/) — React hooks for Ethereum wallet integration
- [Recharts](https://recharts.org/) — composable charting library for React
- [Prisma](https://www.prisma.io/) — type-safe database toolkit

---

## Support

| Channel | Link |
|---------|------|
| Documentation | [docs.aethelred.io](https://docs.aethelred.io) |
| Discord | [discord.gg/aethelred](https://discord.gg/aethelred) |
| Twitter / X | [@AethelredFound](https://twitter.com/AethelredFound) |
| Email | support@aethelred.io |

---

<p align="center">
  <sub>Maintained by the <a href="https://github.com/AethelredFoundation">Aethelred Foundation</a></sub>
</p>
