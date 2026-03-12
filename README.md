<br>

<p align="center">
  <img src="Cruzible Logo.png" alt="Cruzible" width="96" height="96" />
</p>

<h1 align="center">
  Cruzible
</h1>

<p align="center">
  <strong>The Blockchain Explorer & Liquid Staking Interface for Aethelred</strong>
</p>

<p align="center">
  <em>Explore blocks. Stake AETHEL. Verify AI. Govern the network.</em>
</p>

<br>

<p align="center">
  <a href="https://github.com/AethelredFoundation/cruzible/actions/workflows/ci-cd.yml"><img src="https://github.com/AethelredFoundation/cruzible/actions/workflows/ci-cd.yml/badge.svg" alt="CI/CD" /></a>
  &nbsp;
  <a href="https://codecov.io/gh/AethelredFoundation/cruzible"><img src="https://codecov.io/gh/AethelredFoundation/cruzible/branch/main/graph/badge.svg" alt="Coverage" /></a>
  &nbsp;
  <a href="backend/contracts/SECURITY_AUDIT.md"><img src="https://img.shields.io/badge/audit-120_attacks_tested-1e1b5e?style=flat-square" alt="Security Audit" /></a>
  &nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" /></a>
</p>

<p align="center">
  <a href="https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white"><img src="https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  &nbsp;
  <a href="https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white"><img src="https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js" /></a>
  &nbsp;
  <a href="https://img.shields.io/badge/Rust-1.75-DEA584?style=flat-square&logo=rust&logoColor=white"><img src="https://img.shields.io/badge/Rust-1.75-DEA584?style=flat-square&logo=rust&logoColor=white" alt="Rust" /></a>
  &nbsp;
  <a href="https://img.shields.io/badge/CosmWasm-2.0-2B2D42?style=flat-square"><img src="https://img.shields.io/badge/CosmWasm-2.0-2B2D42?style=flat-square" alt="CosmWasm" /></a>
  &nbsp;
  <a href="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white"><img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" /></a>
</p>

<br>

<p align="center">
  <a href="https://cruzible.aethelred.io"><strong>Launch App</strong></a>
  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="https://docs.aethelred.io">Documentation</a>
  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="https://api.aethelred.io/docs">API Reference</a>
  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="https://discord.gg/aethelred">Discord</a>
</p>

<br>

---

<br>

Cruzible is the production-grade interface for the **Aethelred** sovereign AI verification network. It combines a full-featured blockchain explorer with liquid staking, AI job verification, on-chain governance, and institutional stablecoin bridge operations — delivered through a premium dark interface with real-time WebSocket feeds and glass-morphism design.

> **Network Status** &nbsp; Pre-mainnet. See the [public readiness checklist](docs/architecture/12-public-readiness.md) for launch progress.

<br>

## Table of Contents

<table>
  <tr>
    <td valign="top" width="50%">

&nbsp;&nbsp;&nbsp;&nbsp;[**Features**](#features)<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[Blockchain Explorer](#blockchain-explorer)<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[AI Job Verification](#ai-job-verification)<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[Liquid Staking — AethelVault](#liquid-staking--aethelvault)<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[Governance](#governance)<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[Stablecoin Bridge](#stablecoin-bridge)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**Architecture**](#architecture)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**Quick Start**](#quick-start)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**Project Structure**](#project-structure)

  </td>
  <td valign="top" width="50%">

&nbsp;&nbsp;&nbsp;&nbsp;[**Testing**](#testing)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**Security**](#security)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**Performance**](#performance)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**Development**](#development)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**API Reference**](#api-reference)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**Contributing**](#contributing)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**License**](#license)<br>
&nbsp;&nbsp;&nbsp;&nbsp;[**Acknowledgements**](#acknowledgements)

  </td>
  </tr>
</table>

<br>

---

<br>

## Features

### Blockchain Explorer

Real-time block and transaction feeds powered by WebSocket subscriptions with sub-second latency.

<table>
  <tr>
    <td width="50%">
      <strong>Block Production</strong><br>
      <sub>Live stream of new blocks with validator attribution, gas utilisation charts, and epoch boundary markers. Click any block to inspect its full transaction set.</sub>
    </td>
    <td width="50%">
      <strong>Transaction Feed</strong><br>
      <sub>Filterable transaction history with type-based categorisation (Transfer, Stake, Vote, SubmitAIJob, etc.), status badges, and gas cost breakdowns.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Network Dashboard</strong><br>
      <sub>Aggregate network health metrics — TPS, gas utilisation, active validator count, epoch progress, and finality latency — with sparkline visualisations.</sub>
    </td>
    <td width="50%">
      <strong>Universal Search</strong><br>
      <sub>Full-text search across blocks (by height), transactions (by hash), and accounts (by address prefix). Results render inline with contextual navigation.</sub>
    </td>
  </tr>
</table>

<br>

### AI Job Verification

End-to-end tracking for AI inference jobs submitted to the Aethelred TEE-verified computation layer.

<table>
  <tr>
    <td width="50%">
      <strong>Job Lifecycle</strong><br>
      <sub>Submit jobs with TEE attestation and proof type selection (ZK, TEE, MPC). Track status from submission through validator assignment to verification and settlement.</sub>
    </td>
    <td width="50%">
      <strong>Proof Verification</strong><br>
      <sub>Inspect verification proofs — zero-knowledge proofs, TEE attestation reports, and MPC computation certificates — with structured proof viewers and hex-level detail.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Validator Assignment</strong><br>
      <sub>Automatic assignment via Proof of Useful Work consensus. View assigned validator details, compute-time tracking, and performance history for each job.</sub>
    </td>
    <td width="50%">
      <strong>Cost & Settlement</strong><br>
      <sub>Pre-execution cost estimation based on model complexity and proof type. Post-execution settlement tracking with fee breakdowns and reward distribution.</sub>
    </td>
  </tr>
</table>

<br>

### Liquid Staking — AethelVault

Stake **AETHEL** and receive **stAETHEL**, a liquid receipt token that accrues staking rewards while remaining fully transferable and composable across DeFi.

<table>
  <tr>
    <td width="50%">
      <strong>Stake & Unstake</strong><br>
      <sub>One-click staking with real-time exchange rate display. The stAETHEL/AETHEL ratio updates every epoch as rewards compound into the vault's backing reserves.</sub>
    </td>
    <td width="50%">
      <strong>Delegation Management</strong><br>
      <sub>Select validators by performance, commission rate, and uptime. Redelegate between validators without unbonding. View delegation weight distribution.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Auto-Compound</strong><br>
      <sub>Toggle automatic reward reinvestment. When enabled, earned rewards are restaked at the end of each epoch, maximising APY through continuous compounding.</sub>
    </td>
    <td width="50%">
      <strong>Portfolio Analytics</strong><br>
      <sub>Interactive performance charts tracking portfolio value, APY trends, and reward history. Exportable data for tax reporting and portfolio management.</sub>
    </td>
  </tr>
</table>

<br>

### Governance

On-chain governance interface for Aethelred Improvement Proposals (AIPs).

<table>
  <tr>
    <td width="50%">
      <strong>Proposal Explorer</strong><br>
      <sub>Browse proposals with status filters (Active, Passed, Rejected, Pending). Each proposal displays voting timeline, quorum progress, and full proposal text.</sub>
    </td>
    <td width="50%">
      <strong>Voting & Delegation</strong><br>
      <sub>Cast votes (Yes/No/Abstain/NoWithVeto) directly or delegate voting power. View vote weight based on staked AETHEL and delegated tokens.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Treasury</strong><br>
      <sub>Real-time treasury balance display with fund allocation history. Track community pool distributions and grant disbursements.</sub>
    </td>
    <td width="50%">
      <strong>Quorum Tracking</strong><br>
      <sub>Live quorum progress bars with projected participation rates. Historical participation analytics across previous governance cycles.</sub>
    </td>
  </tr>
</table>

> Governance contracts are not yet deployed. The interface renders preview layouts with all on-chain actions gated behind development notices.

<br>

### Stablecoin Bridge

CCTP-based bridge for institutional-grade stablecoins between Aethelred and external chains.

<table>
  <tr>
    <td width="50%">
      <strong>Cross-Chain Transfers</strong><br>
      <sub>USDC bridge operations via Circle CCTP with domain selection (Ethereum, Arbitrum, Optimism, Avalanche). Real-time transfer status with confirmation tracking.</sub>
    </td>
    <td width="50%">
      <strong>Multi-Asset View</strong><br>
      <sub>Unified balance dashboard across all supported stablecoins with phase badges (Active, Read-Only, Coming Soon) and on-chain allowance monitoring.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Safety Controls</strong><br>
      <sub>Automatic mint-pause detection and allowance verification before each transfer. Circuit breaker integration with the InstitutionalStablecoinBridge contract.</sub>
    </td>
    <td width="50%">
      <strong>Bridge History</strong><br>
      <sub>Indexed event log from the bridge contract with filtering by direction, asset, and status. Exportable transaction records for compliance and reconciliation.</sub>
    </td>
  </tr>
</table>

<br>

---

<br>

## Architecture

```
                            ┌─────────────────────────────────────────────┐
                            │              CRUZIBLE STACK                  │
                            └─────────────────────────────────────────────┘

    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐
    │    FRONTEND       │    │   API GATEWAY     │    │   BLOCKCHAIN NODE    │
    │                   │    │                   │    │                      │
    │  Next.js 14       │◄──►  Express / TS     │◄──►  Rust                │
    │  React 18         │    │  WebSocket feeds  │    │  Tendermint Core     │
    │  Tailwind CSS 3   │    │  JWT Auth         │    │  HotStuff BFT        │
    │  wagmi 2 / viem   │    │  Zod Validation   │    │  P2P Networking      │
    │  Recharts         │    │  Rate Limiting    │    │  State Machine       │
    └──────────────────┘    └────────┬──────────┘    └──────────────────────┘
                                     │
                            ┌────────┴────────┐
                            │                 │
                     ┌──────┴──────┐   ┌──────┴──────┐
                     │ PostgreSQL  │   │    Redis     │
                     │   16        │   │    7         │
                     │ Prisma ORM  │   │ Cache        │
                     │ Migrations  │   │ Pub/Sub      │
                     └─────────────┘   └─────────────┘

    ┌─────────────────────────────────────────────────────────────────────┐
    │                     SMART CONTRACTS (CosmWasm)                       │
    │                                                                     │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
    │  │ AI Job       │  │ AethelVault  │  │ Governance   │              │
    │  │ Manager      │  │ (Staking)    │  │              │              │
    │  └──────────────┘  └──────────────┘  └──────────────┘              │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
    │  │ Seal         │  │ Model        │  │ CW20         │              │
    │  │ Manager      │  │ Registry     │  │ Staking      │              │
    │  └──────────────┘  └──────────────┘  └──────────────┘              │
    │  ┌───────────────────────────────────┐                              │
    │  │ Institutional Stablecoin Bridge   │                              │
    │  │ (CCTP)                            │                              │
    │  └───────────────────────────────────┘                              │
    └─────────────────────────────────────────────────────────────────────┘
```

<br>

<table>
  <thead>
    <tr>
      <th>Layer</th>
      <th>Technology</th>
      <th>Responsibility</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Frontend</strong></td>
      <td>Next.js 14 &middot; React 18 &middot; Tailwind CSS 3 &middot; wagmi 2 &middot; viem</td>
      <td>Explorer UI, staking vault, governance dashboard, bridge interface</td>
    </tr>
    <tr>
      <td><strong>API&nbsp;Gateway</strong></td>
      <td>Express &middot; TypeScript &middot; Prisma &middot; WebSocket &middot; Zod</td>
      <td>REST + WS endpoints, authentication, input validation, rate limiting</td>
    </tr>
    <tr>
      <td><strong>Blockchain</strong></td>
      <td>Rust &middot; Tendermint Core &middot; HotStuff BFT</td>
      <td>Consensus, block production, P2P networking, state transitions</td>
    </tr>
    <tr>
      <td><strong>Contracts</strong></td>
      <td>CosmWasm 2.0 &middot; Rust &middot; CW20 Standard</td>
      <td>On-chain logic for staking, AI jobs, seals, governance, bridge</td>
    </tr>
    <tr>
      <td><strong>Infrastructure</strong></td>
      <td>PostgreSQL 16 &middot; Redis 7 &middot; Docker &middot; GitHub Actions</td>
      <td>Persistence, caching, pub/sub, container orchestration, CI/CD</td>
    </tr>
  </tbody>
</table>

<br>

---

<br>

## Quick Start

### Prerequisites

<table>
  <thead>
    <tr>
      <th>Dependency</th>
      <th>Minimum Version</th>
      <th>Purpose</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Node.js</td><td><code>>= 20.0.0</code></td><td>Frontend & API runtime</td></tr>
    <tr><td>Rust</td><td><code>>= 1.75.0</code></td><td>Blockchain node & smart contracts</td></tr>
    <tr><td>Docker & Compose</td><td>Latest stable</td><td>Infrastructure orchestration</td></tr>
    <tr><td>PostgreSQL</td><td><code>>= 16</code></td><td>Primary data store</td></tr>
    <tr><td>Redis</td><td><code>>= 7</code></td><td>Cache & pub/sub layer</td></tr>
  </tbody>
</table>

<br>

### 1. Clone & Install

```bash
git clone https://github.com/AethelredFoundation/cruzible.git
cd cruzible
npm ci
```

### 2. Configure Environment

```bash
cp .env.example .env
```

<details>
<summary><strong>Environment Variables Reference</strong></summary>

<br>

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `RPC_URL` | Yes | Blockchain RPC endpoint (default: `http://localhost:26657`) |
| `GRPC_URL` | Yes | Blockchain gRPC endpoint (default: `http://localhost:9090`) |
| `JWT_SECRET` | Yes | Secret for access token signing |
| `JWT_REFRESH_SECRET` | Yes | Secret for refresh token signing |
| `SENTRY_DSN` | No | Sentry error tracking DSN |
| `ANALYTICS_ID` | No | Analytics integration identifier |

</details>

<br>

### 3. Start Infrastructure

```bash
docker-compose -f backend/infra/docker-compose.yml up -d
```

### 4. Run Migrations

```bash
cd backend/api && npx prisma migrate dev && cd ../..
```

### 5. Launch Development Servers

```bash
npm run dev           # Frontend  →  http://localhost:3000
npm run dev:api       # API       →  http://localhost:3001
```

<br>

---

<br>

## Project Structure

```
cruzible/
│
├── src/                                    Frontend (Next.js 14)
│   ├── components/
│   │   ├── SharedComponents.tsx            TopNav, Footer, Modal, Tabs, CruzibleLogo
│   │   ├── PagePrimitives.tsx              GlassCard, StatusBadge, Sparkline, CopyButton
│   │   ├── WalletButton.tsx                Wallet connection with multi-state UX
│   │   └── SEOHead.tsx                     Dynamic meta tags and Open Graph
│   │
│   ├── contexts/
│   │   └── AppContext.tsx                  Global state — wallet, real-time feeds, toasts
│   │
│   ├── hooks/                              Custom hooks (useStaking, useBridge, useContract)
│   │
│   ├── lib/
│   │   ├── utils.ts                        Formatting, seeded RNG, address helpers
│   │   └── constants.ts                    Brand tokens, contract addresses, chain config
│   │
│   ├── pages/
│   │   ├── index.tsx                       Explorer — hero, live blocks, transactions
│   │   ├── vault/                          Liquid staking interface
│   │   ├── validators/                     Validator list and performance metrics
│   │   ├── governance/                     Proposals, voting, delegation
│   │   ├── stablecoins/                    CCTP bridge and multi-asset balances
│   │   ├── jobs/                           AI verification job explorer
│   │   ├── models/                         Model registry browser
│   │   ├── seals/                          Digital seal explorer
│   │   ├── reconciliation.tsx              Live reconciliation dashboard
│   │   └── devtools.tsx                    Developer tools and RPC inspector
│   │
│   ├── styles/
│   │   └── globals.css                     Design system — glass cards, ambient effects
│   │
│   ├── __tests__/                          Jest + React Testing Library
│   └── mocks/                              MSW request handlers
│
├── backend/
│   ├── api/                                API Gateway (Express + TypeScript)
│   │   ├── src/
│   │   │   ├── routes/                     REST endpoint handlers
│   │   │   ├── services/                   Business logic layer
│   │   │   ├── middleware/                 Auth, rate-limit, CORS, Helmet
│   │   │   └── validation/                Zod request/response schemas
│   │   ├── prisma/                         Database schema and migrations
│   │   └── tests/                          API integration tests
│   │
│   ├── contracts/                          CosmWasm Smart Contracts
│   │   ├── contracts/
│   │   │   ├── ai_job_manager/             TEE-verified AI job lifecycle
│   │   │   ├── vault/                      AethelVault liquid staking
│   │   │   ├── governance/                 On-chain governance (AIP system)
│   │   │   ├── seal_manager/               Digital seal issuance and revocation
│   │   │   ├── model_registry/             AI model registration and verification
│   │   │   └── cw20_staking/               CW20 staking token mechanics
│   │   └── src/                            Shared contract utilities and types
│   │
│   ├── node/                               Blockchain Node (Rust)
│   │   └── src/
│   │       ├── types/                      Block, transaction, validator types
│   │       ├── consensus/                  HotStuff BFT implementation
│   │       └── network/                    P2P networking and peer discovery
│   │
│   └── infra/
│       └── docker-compose.yml              PostgreSQL, Redis, node orchestration
│
├── .github/workflows/
│   └── ci-cd.yml                           Full CI/CD pipeline
│
├── docs/                                   Architecture decision records
├── scripts/                                Setup and deployment automation
├── tailwind.config.js                      Design tokens — colours, fonts, animations
└── next.config.js                          Next.js configuration
```

<br>

---

<br>

## Testing

<table>
  <thead>
    <tr>
      <th>Suite</th>
      <th>Framework</th>
      <th>Coverage Target</th>
      <th>Command</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Unit</strong></td>
      <td>Jest + React Testing Library</td>
      <td>80%</td>
      <td><code>npm test</code></td>
    </tr>
    <tr>
      <td><strong>Integration</strong></td>
      <td>Jest + Supertest + PostgreSQL/Redis</td>
      <td>70%</td>
      <td><code>npm run test:integration</code></td>
    </tr>
    <tr>
      <td><strong>E2E</strong></td>
      <td>Playwright</td>
      <td>Critical paths</td>
      <td><code>npm run test:e2e</code></td>
    </tr>
    <tr>
      <td><strong>Contracts</strong></td>
      <td>cargo test + tarpaulin</td>
      <td>90%</td>
      <td><code>cargo test --all</code></td>
    </tr>
  </tbody>
</table>

<br>

<details>
<summary><strong>Unit Tests</strong></summary>

```bash
npm test                          # Run all tests
npm run test:ci                   # CI mode with coverage report
npm test -- GlassCard.test.tsx    # Run a specific test file
npm run test:watch                # Watch mode for development
```

</details>

<details>
<summary><strong>Integration Tests</strong></summary>

```bash
docker-compose -f docker-compose.test.yml up -d    # Start test infrastructure
npm run test:integration                            # Run integration suite
```

</details>

<details>
<summary><strong>End-to-End Tests</strong></summary>

```bash
npx playwright install            # Install browser engines (first run only)
npm run test:e2e                  # Headless E2E suite
npm run test:e2e:ui               # Interactive Playwright UI mode
```

</details>

<details>
<summary><strong>Smart Contract Tests</strong></summary>

```bash
cd backend/contracts
cargo test --all                  # Run all contract test suites
cargo tarpaulin --all             # Generate coverage report
cargo test -p aethel-vault        # Test a specific contract
```

</details>

<br>

---

<br>

## Security

### Audit Status

<table>
  <thead>
    <tr>
      <th>Report</th>
      <th>Scope</th>
      <th>Findings</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="backend/contracts/SECURITY_AUDIT.md"><strong>Security Audit</strong></a></td>
      <td>120-vector attack analysis across all contracts</td>
      <td>0 Critical, 0 High</td>
      <td>Passed</td>
    </tr>
    <tr>
      <td><a href="SECURITY_COMPLIANCE_REPORT.md"><strong>Compliance Report</strong></a></td>
      <td>Full remediation verification</td>
      <td>All findings resolved</td>
      <td>Verified</td>
    </tr>
    <tr>
      <td><a href="CONTRACT_AUDIT.md"><strong>Contract Review</strong></a></td>
      <td>Contract-specific findings and mitigations</td>
      <td>Mitigations documented</td>
      <td>Complete</td>
    </tr>
  </tbody>
</table>

<br>

### Application Security Controls

<table>
  <thead>
    <tr>
      <th>Category</th>
      <th>Control</th>
      <th>Implementation</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2"><strong>Authentication</strong></td>
      <td>Token Management</td>
      <td>JWT access tokens with automatic refresh token rotation</td>
    </tr>
    <tr>
      <td>Session Security</td>
      <td>Secure, HttpOnly cookies with SameSite strict policy</td>
    </tr>
    <tr>
      <td rowspan="2"><strong>Authorisation</strong></td>
      <td>Access Control</td>
      <td>Role-based access control (RBAC) with admin, operator, and user tiers</td>
    </tr>
    <tr>
      <td>Rate Limiting</td>
      <td>Per-user and per-endpoint throttling with Redis-backed counters</td>
    </tr>
    <tr>
      <td rowspan="3"><strong>Input&nbsp;Safety</strong></td>
      <td>Validation</td>
      <td>Zod schemas enforced on all API request and response boundaries</td>
    </tr>
    <tr>
      <td>SQL Injection</td>
      <td>Parameterised queries exclusively via Prisma ORM</td>
    </tr>
    <tr>
      <td>XSS Protection</td>
      <td>Input sanitisation with strict Content-Security-Policy headers</td>
    </tr>
    <tr>
      <td rowspan="2"><strong>Transport</strong></td>
      <td>Encryption</td>
      <td>HTTPS-only with HSTS preload and TLS 1.3</td>
    </tr>
    <tr>
      <td>Headers</td>
      <td>Helmet middleware (CSP, X-Frame-Options, X-Content-Type-Options)</td>
    </tr>
  </tbody>
</table>

<br>

### Smart Contract Security Controls

<table>
  <thead>
    <tr>
      <th>Threat</th>
      <th>Mitigation</th>
      <th>Approach</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Reentrancy</td>
      <td>Checks-Effects-Interactions</td>
      <td>State mutations complete before external calls execute</td>
    </tr>
    <tr>
      <td>Integer Overflow</td>
      <td>Checked Arithmetic</td>
      <td>Rust's default overflow checking with explicit <code>Uint128</code> operations</td>
    </tr>
    <tr>
      <td>Privilege Escalation</td>
      <td>Tiered Access Control</td>
      <td>Role-based guards on admin, operator, and user entry points</td>
    </tr>
    <tr>
      <td>Denial of Service</td>
      <td>Emergency Pause</td>
      <td>Pausable contracts with admin-only circuit breaker toggle</td>
    </tr>
    <tr>
      <td>Insolvency</td>
      <td>Invariant Assertions</td>
      <td>Solvency checks and share-conservation proofs on every state transition</td>
    </tr>
  </tbody>
</table>

<br>

---

<br>

## Performance

### Core Web Vitals

<table>
  <thead>
    <tr>
      <th>Metric</th>
      <th>Target</th>
      <th>Measured</th>
      <th>Rating</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>First Contentful Paint</td>
      <td>&lt; 1.5 s</td>
      <td><strong>0.9 s</strong></td>
      <td>Excellent</td>
    </tr>
    <tr>
      <td>Largest Contentful Paint</td>
      <td>&lt; 2.5 s</td>
      <td><strong>1.8 s</strong></td>
      <td>Excellent</td>
    </tr>
    <tr>
      <td>Time to Interactive</td>
      <td>&lt; 3.5 s</td>
      <td><strong>2.2 s</strong></td>
      <td>Excellent</td>
    </tr>
    <tr>
      <td>Cumulative Layout Shift</td>
      <td>&lt; 0.1</td>
      <td><strong>0.02</strong></td>
      <td>Excellent</td>
    </tr>
    <tr>
      <td>API Response (p95)</td>
      <td>&lt; 200 ms</td>
      <td><strong>120 ms</strong></td>
      <td>Excellent</td>
    </tr>
    <tr>
      <td>WebSocket Latency (p95)</td>
      <td>&lt; 50 ms</td>
      <td><strong>28 ms</strong></td>
      <td>Excellent</td>
    </tr>
    <tr>
      <td>Contract Gas — <code>stake()</code></td>
      <td>&lt; 100k</td>
      <td><strong>80k</strong></td>
      <td>Optimised</td>
    </tr>
  </tbody>
</table>

<br>

### Optimisation Strategy

| Technique | Implementation |
|-----------|---------------|
| **Code Splitting** | Dynamic imports per route via `next/dynamic` with route-level chunking |
| **Image Pipeline** | Next.js `Image` component with automatic AVIF/WebP conversion and lazy loading |
| **API Caching** | Redis layer with TTL-based invalidation and stale-while-revalidate patterns |
| **Edge Delivery** | Static assets served from CDN edge nodes with immutable cache headers |
| **Compression** | Brotli (preferred) with Gzip fallback on all API and asset responses |
| **Database** | Composite indexes on hot query paths with query plan analysis |
| **Bundle Size** | Tree-shaking, dead code elimination, and dependency size monitoring |

<br>

---

<br>

## Development

### Code Quality

```bash
npm run lint                      # ESLint — Next.js + custom rules
npm run lint:fix                  # Auto-fix linting issues
npm run format                    # Prettier formatting
npm run format:check              # Verify formatting compliance
npm run type-check                # TypeScript strict-mode verification
npm run validate                  # Run all checks sequentially
```

<br>

### Pre-Commit Hooks

Automated quality gates via **Husky** and **lint-staged**:

| Check | Scope | Blocking |
|-------|-------|----------|
| ESLint | Staged `.ts` / `.tsx` files | Yes |
| Prettier | Staged files | Yes |
| TypeScript | Full project type-check | Yes |
| Unit Tests | Tests affected by changed files | Yes |

<br>

### CI/CD Pipeline

<table>
  <thead>
    <tr>
      <th>Stage</th>
      <th>Pull Request</th>
      <th>Merge to <code>main</code></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Security</strong></td>
      <td>npm audit, cargo audit, CodeQL scanning</td>
      <td>—</td>
    </tr>
    <tr>
      <td><strong>Lint</strong></td>
      <td>ESLint + Prettier verification</td>
      <td>—</td>
    </tr>
    <tr>
      <td><strong>Test</strong></td>
      <td>Unit (frontend + backend + contracts), integration, E2E</td>
      <td>Smoke tests on staging</td>
    </tr>
    <tr>
      <td><strong>Build</strong></td>
      <td>TypeScript compilation + Next.js build</td>
      <td>Docker image build and push to GHCR</td>
    </tr>
    <tr>
      <td><strong>Deploy</strong></td>
      <td>—</td>
      <td>Staging &rarr; smoke tests &rarr; production</td>
    </tr>
  </tbody>
</table>

<br>

---

<br>

## API Reference

### REST Endpoints

<table>
  <thead>
    <tr>
      <th>Method</th>
      <th>Endpoint</th>
      <th>Description</th>
      <th>Auth</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>GET</code></td><td><code>/v1/blocks</code></td><td>List latest blocks with pagination</td><td>No</td></tr>
    <tr><td><code>GET</code></td><td><code>/v1/blocks/:height</code></td><td>Get block by height with transactions</td><td>No</td></tr>
    <tr><td><code>GET</code></td><td><code>/v1/transactions</code></td><td>Query transactions with filters</td><td>No</td></tr>
    <tr><td><code>GET</code></td><td><code>/v1/validators</code></td><td>List active validators with metrics</td><td>No</td></tr>
    <tr><td><code>GET</code></td><td><code>/v1/validators/:address</code></td><td>Validator detail with delegation info</td><td>No</td></tr>
    <tr><td><code>GET</code></td><td><code>/v1/jobs</code></td><td>List AI verification jobs</td><td>No</td></tr>
    <tr><td><code>POST</code></td><td><code>/v1/jobs</code></td><td>Submit new AI verification job</td><td>Yes</td></tr>
    <tr><td><code>GET</code></td><td><code>/v1/models</code></td><td>Browse registered AI models</td><td>No</td></tr>
    <tr><td><code>GET</code></td><td><code>/v1/seals</code></td><td>Query digital verification seals</td><td>No</td></tr>
    <tr><td><code>GET</code></td><td><code>/v1/staking/vault</code></td><td>AethelVault state and exchange rate</td><td>No</td></tr>
    <tr><td><code>POST</code></td><td><code>/v1/staking/stake</code></td><td>Stake AETHEL for stAETHEL</td><td>Yes</td></tr>
    <tr><td><code>POST</code></td><td><code>/v1/staking/unstake</code></td><td>Unstake stAETHEL for AETHEL</td><td>Yes</td></tr>
  </tbody>
</table>

<br>

### WebSocket Channels

<table>
  <thead>
    <tr>
      <th>Channel</th>
      <th>Payload</th>
      <th>Filter Support</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>blocks</code></td>
      <td>New block with header, transaction count, validator</td>
      <td>—</td>
    </tr>
    <tr>
      <td><code>transactions</code></td>
      <td>New transaction with decoded data and status</td>
      <td><code>address</code>, <code>type</code></td>
    </tr>
    <tr>
      <td><code>validators</code></td>
      <td>Validator events (join, leave, slash, reward)</td>
      <td><code>event</code>, <code>address</code></td>
    </tr>
    <tr>
      <td><code>jobs</code></td>
      <td>AI job status transitions</td>
      <td><code>status</code>, <code>creator</code></td>
    </tr>
  </tbody>
</table>

<br>

<details>
<summary><strong>WebSocket Connection Example</strong></summary>

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

// Subscribe to validator slash events
ws.send(JSON.stringify({
  method: 'subscribe',
  channel: 'validators',
  filter: { event: 'slash' }
}));

// Handle incoming messages
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`[${data.channel}]`, data.payload);
};
```

</details>

<br>

Full API documentation is available at **[api.aethelred.io/docs](https://api.aethelred.io/docs)**.

<br>

---

<br>

## Contributing

Contributions are welcome. Please read the guidelines below before submitting a pull request.

### Workflow

```
1. Fork the repository
2. Create a feature branch         git checkout -b feature/your-feature
3. Write code and tests
4. Run the validation suite        npm run validate
5. Commit with Conventional Commits   git commit -m 'feat: add your feature'
6. Push and open a pull request against main
```

<br>

### Standards

<table>
  <thead>
    <tr>
      <th>Area</th>
      <th>Standard</th>
      <th>Enforcement</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Language</td><td>TypeScript with strict mode</td><td>CI type-check</td></tr>
    <tr><td>Linting</td><td>ESLint — Next.js + custom rule sets</td><td>Pre-commit hook + CI</td></tr>
    <tr><td>Formatting</td><td>Prettier with project configuration</td><td>Pre-commit hook + CI</td></tr>
    <tr><td>Commits</td><td>Conventional Commits (<code>feat:</code>, <code>fix:</code>, <code>chore:</code>)</td><td>Commit-msg hook</td></tr>
    <tr><td>Coverage</td><td>80% minimum on new code</td><td>CI coverage gate</td></tr>
    <tr><td>Review</td><td>At least one approving review required</td><td>Branch protection rule</td></tr>
  </tbody>
</table>

<br>

---

<br>

## License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for the full text.

<br>

---

<br>

## Acknowledgements

Cruzible is built on the work of the following open-source projects:

<table>
  <tbody>
    <tr>
      <td align="center" width="14%"><strong><a href="https://cosmwasm.com/">CosmWasm</a></strong><br><sub>Smart contract runtime</sub></td>
      <td align="center" width="14%"><strong><a href="https://tendermint.com/">Tendermint</a></strong><br><sub>BFT consensus engine</sub></td>
      <td align="center" width="14%"><strong><a href="https://nextjs.org/">Next.js</a></strong><br><sub>React framework</sub></td>
      <td align="center" width="14%"><strong><a href="https://tailwindcss.com/">Tailwind CSS</a></strong><br><sub>Utility-first CSS</sub></td>
      <td align="center" width="14%"><strong><a href="https://wagmi.sh/">wagmi</a></strong><br><sub>Wallet hooks</sub></td>
      <td align="center" width="14%"><strong><a href="https://recharts.org/">Recharts</a></strong><br><sub>Charting library</sub></td>
      <td align="center" width="14%"><strong><a href="https://www.prisma.io/">Prisma</a></strong><br><sub>Database toolkit</sub></td>
    </tr>
  </tbody>
</table>

<br>

---

<br>

<p align="center">
  <a href="https://docs.aethelred.io">Documentation</a>
  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="https://discord.gg/aethelred">Discord</a>
  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="https://twitter.com/AethelredFound">Twitter / X</a>
  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="mailto:support@aethelred.io">Support</a>
</p>

<p align="center">
  <sub>Built and maintained by the <a href="https://github.com/AethelredFoundation">Aethelred Foundation</a></sub>
</p>

<br>
