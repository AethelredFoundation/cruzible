# Aethelred Cruzible

[![CI/CD](https://github.com/aethelred/cruzible/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/aethelred/cruzible/actions)
[![Coverage](https://codecov.io/gh/aethelred/cruzible/branch/main/graph/badge.svg)](https://codecov.io/gh/aethelred/cruzible)
[![Security](https://img.shields.io/badge/security-internal_review-yellow)](backend/contracts/SECURITY_AUDIT.md)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Blockchain dashboard and liquid staking interface for the Aethelred sovereign AI verification network** — pre-mainnet; see [public readiness checklist](docs/architecture/12-public-readiness.md)

[Demo](https://demo.aethelred.io) • [Documentation](https://docs.aethelred.io) • [API Reference](https://api.aethelred.io/docs)

---

## 🌟 Features

### Blockchain Explorer
- **Real-time block tracking** - Monitor blocks as they're produced
- **Transaction details** - Full transaction history with filtering
- **Validator monitoring** - Track validator performance and uptime
- **Network statistics** - Comprehensive network health metrics

### AI Job Verification
- **Job submission** - Submit AI inference jobs with TEE attestation
- **Validator assignment** - Automatic validator selection for verification
- **Proof verification** - ZK proofs, TEE attestations, MPC proofs
- **Payment settlement** - Automated payment distribution

### Liquid Staking (stAETHEL)
- **Stake AETHEL** - Earn rewards while maintaining liquidity
- **Instant liquidity** - Trade stAETHEL without unbonding
- **Validator selection** - Choose validators or auto-delegate
- **Reward claiming** - Compound or claim rewards

### Governance *(under development — not yet deployed on-chain)*
- **Proposal creation** - Submit protocol upgrade proposals
- **Voting** - Participate in on-chain governance
- **Delegation** - Delegate voting power
- **Treasury** - Community fund management

> **Note:** The governance contract is not yet deployed. The UI shows preview layouts but all on-chain actions (proposal submission, voting, delegation) are gated with development notices. See the [public readiness checklist](docs/architecture/12-public-readiness.md) for current launch status.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CRUZIBLE ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐      ┌─────────────────┐      ┌──────────┐ │
│  │   Next.js       │      │   Express API   │      │   Rust   │ │
│  │   (Frontend)    │◄────►│   (Gateway)     │◄────►│  (Node)  │ │
│  │   React 18      │      │   TypeScript    │      │  Tendermint│ │
│  │   Tailwind CSS  │      │   WebSocket     │      │  HotStuff  │ │
│  └─────────────────┘      └────────┬────────┘      └──────────┘ │
│                                     │                            │
│                           ┌─────────┴─────────┐                  │
│                           │                   │                  │
│                      ┌────┴────┐        ┌────┴────┐             │
│                      │PostgreSQL│        │  Redis  │             │
│                      │  Prisma │        │  Cache  │             │
│                      └─────────┘        └─────────┘             │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              COSMWASM SMART CONTRACTS                      │  │
│  │  • AI Job Manager  • AethelVault  • Governance            │  │
│  │  • Seal Manager    • Model Registry  • CW20 Staking      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **Rust** >= 1.75.0
- **Docker** & **Docker Compose**
- **PostgreSQL** >= 16
- **Redis** >= 7

### Installation

```bash
# Clone the repository
git clone https://github.com/aethelred/cruzible.git
cd cruzible

# Install dependencies
npm ci

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Start infrastructure
docker-compose -f backend/infra/docker-compose.yml up -d

# Run database migrations
cd backend/api && npx prisma migrate dev

# Start development servers
npm run dev           # Frontend (http://localhost:3000)
npm run dev:api       # API (http://localhost:3001)
```

### Environment Variables

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

---

## 📁 Project Structure

```
cruzible/
├── src/                          # Frontend (Next.js)
│   ├── components/               # React components
│   │   ├── PagePrimitives.tsx   # Base UI components
│   │   ├── SharedComponents.tsx # Shared UI elements
│   │   └── SEOHead.tsx          # SEO component
│   ├── contexts/                # React contexts
│   │   └── AppContext.tsx       # Global app state
│   ├── hooks/                   # Custom React hooks
│   ├── lib/                     # Utilities & constants
│   │   ├── utils.ts             # Helper functions
│   │   └── constants.ts         # App constants
│   ├── pages/                   # Next.js pages
│   │   ├── index.tsx            # Homepage
│   │   ├── validators/          # Validator pages
│   │   ├── jobs/                # AI job pages
│   │   ├── vault/               # Staking pages
│   │   └── governance/          # Governance pages
│   ├── __tests__/               # Test suites
│   └── mocks/                   # MSW mocks
│
├── backend/
│   ├── api/                     # API Gateway (Express)
│   │   ├── src/
│   │   │   ├── routes/          # API routes
│   │   │   ├── services/        # Business logic
│   │   │   ├── middleware/      # Express middleware
│   │   │   ├── validation/      # Zod schemas
│   │   │   ├── auth/            # Authentication
│   │   │   └── index.ts         # Entry point
│   │   ├── prisma/              # Database schema
│   │   └── tests/               # API tests
│   │
│   ├── contracts/               # CosmWasm smart contracts
│   │   ├── contracts/
│   │   │   ├── ai_job_manager/  # AI job contract
│   │   │   ├── vault/           # Liquid staking
│   │   │   ├── governance/      # Governance
│   │   │   ├── seal_manager/    # Digital seals
│   │   │   ├── model_registry/  # AI models
│   │   │   └── cw20_staking/    # Staking token
│   │   └── src/
│   │
│   ├── node/                    # Blockchain node (Rust)
│   │   └── src/
│   │       ├── types/           # Data types
│   │       ├── consensus/       # HotStuff BFT
│   │       └── network/         # P2P networking
│   │
│   └── infra/                   # Infrastructure
│       └── docker-compose.yml   # Service orchestration
│
├── .github/
│   └── workflows/               # CI/CD pipelines
│       └── ci-cd.yml
│
├── docs/                        # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── DEPLOYMENT.md
│
└── scripts/                     # Utility scripts
    ├── setup.sh
    └── deploy.sh
```

---

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- GlassCard.test.tsx

# Watch mode
npm run test:watch
```

### Integration Tests

```bash
# Start test environment
docker-compose -f docker-compose.test.yml up -d

# Run integration tests
npm run test:integration
```

### E2E Tests

```bash
# Install Playwright browsers
npx playwright install

# Run E2E tests
npm run test:e2e

# Run with UI
npm run test:e2e:ui
```

### Smart Contract Tests

```bash
cd backend/contracts

# Run all contract tests
cargo test --all

# Run with coverage
cargo tarpaulin --all

# Run specific contract
cargo test -p aethel-vault
```

---

## 🔒 Security

### Audit Reports

- [Security Audit](backend/contracts/SECURITY_AUDIT.md) - Comprehensive 120-attack analysis
- [Compliance Report](SECURITY_COMPLIANCE_REPORT.md) - Remediation verification
- [Smart Contract Review](CONTRACT_AUDIT.md) - Contract-specific findings

### Security Features

- ✅ **Authentication** - JWT-based with refresh tokens
- ✅ **Authorization** - Role-based access control (RBAC)
- ✅ **Input Validation** - Zod schemas for all inputs
- ✅ **Rate Limiting** - Per-user and per-endpoint limits
- ✅ **CORS** - Configured for production domains
- ✅ **Helmet** - Security headers
- ✅ **SQL Injection** - Parameterized queries (Prisma)
- ✅ **XSS Protection** - Input sanitization

### Smart Contract Security

- ✅ **Reentrancy Guard** - Checks-effects-interactions pattern
- ✅ **Overflow Protection** - Checked arithmetic operations
- ✅ **Access Control** - Role-based permissions
- ✅ **Pause Mechanism** - Emergency stop functionality
- ✅ **Invariant Checking** - Solvency and share conservation

---

## 📊 Performance

### Metrics

| Metric | Target | Current |
|--------|--------|---------|
| First Contentful Paint | < 1.5s | 0.9s |
| Largest Contentful Paint | < 2.5s | 1.8s |
| Time to Interactive | < 3.5s | 2.2s |
| API Response Time (p95) | < 200ms | 120ms |
| Contract Gas (stake) | < 100k | 80k |

### Optimization Features

- **Code Splitting** - Dynamic imports for routes
- **Image Optimization** - Next.js Image component
- **Caching** - Redis for API responses
- **CDN** - Static assets served from edge
- **Compression** - Gzip/Brotli for responses
- **Database Indexing** - Optimized queries

---

## 🛠️ Development

### Code Quality

```bash
# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:check

# Type checking
npm run type-check

# Run all checks
npm run validate
```

### Git Hooks

Pre-commit hooks automatically run:
- ESLint
- Prettier
- TypeScript check
- Unit tests (changed files only)

### CI/CD Pipeline

Every PR triggers:
1. Security audit (npm audit, cargo audit)
2. Lint & format checks
3. Unit tests (frontend, backend, contracts)
4. Integration tests
5. E2E tests
6. Build verification

On merge to main:
1. Build Docker images
2. Push to registry
3. Deploy to staging
4. Run smoke tests
5. Deploy to production

---

## 📖 API Documentation

### REST API

```bash
# Get latest blocks
curl https://api.aethelred.io/v1/blocks?limit=10

# Get block by height
curl https://api.aethelred.io/v1/blocks/1000000

# Get transactions
curl https://api.aethelred.io/v1/transactions?sender=aethelred1...

# Get validator info
curl https://api.aethelred.io/v1/validators/aethelred1...
```

### WebSocket API

```javascript
const ws = new WebSocket('wss://api.aethelred.io/ws');

// Subscribe to new blocks
ws.send(JSON.stringify({
  method: 'subscribe',
  channel: 'blocks'
}));

// Subscribe to transactions
ws.send(JSON.stringify({
  method: 'subscribe',
  channel: 'transactions',
  filter: { address: 'aethelred1...' }
}));
```

Full API documentation: https://api.aethelred.io/docs

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm run validate`)
5. Commit changes (`git commit -m 'Add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Standards

- **TypeScript** - Strict mode enabled
- **ESLint** - Next.js + custom rules
- **Prettier** - Consistent formatting
- **Conventional Commits** - Structured commit messages
- **Test Coverage** - 80% minimum

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [CosmWasm](https://cosmwasm.com/) - Smart contract framework
- [Tendermint](https://tendermint.com/) - Consensus engine
- [Next.js](https://nextjs.org/) - React framework
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework

---

## 📞 Support

- **Documentation**: https://docs.aethelred.io
- **Discord**: https://discord.gg/aethelred
- **Twitter**: https://twitter.com/aethelred
- **Email**: support@aethelred.io

---

<p align="center">
  Built with ❤️ by the Aethelred Labs team
</p>
