# Aethelred Blockchain Backend

> **World-class, production-ready blockchain infrastructure for the Aethelred sovereign AI verification network.**

## 🏛️ Architecture Overview

The Aethelred backend is a sophisticated, multi-layer blockchain infrastructure designed for high-throughput, verifiable AI computation at scale.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Web App   │  │  Mobile App │  │   CLI Tool  │  │  SDK/WASM   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼───────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY LAYER                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          NGINX (Load Balancer)                      │    │
│  │                    SSL/TLS, Rate Limiting, Caching                  │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │                                        │
│  ┌──────────────────────────────────┴──────────────────────────────────┐    │
│  │                     Node.js/TypeScript API Gateway                   │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │    │
│  │  │  REST   │ │WebSocket│ │  gRPC   │ │ GraphQL │ │Metrics  │       │    │
│  │  │  API    │ │  Real-time │ │ Gateway │ │ (Future)│ │/tracing │       │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INDEXING LAYER                                      │
│  ┌─────────────────────────┐    ┌─────────────────────────────────────────┐ │
│  │      Indexer Service    │    │         PostgreSQL Database             │ │
│  │  (Block/Tx ingestion)   │───▶│  Blocks │ Txs │ Validators │ AI Jobs    │ │
│  └─────────────────────────┘    └─────────────────────────────────────────┘ │
│                                                                             │
│  ┌─────────────────────────┐    ┌─────────────────────────────────────────┐ │
│  │       Redis Cache       │    │         BullMQ Job Queue               │ │
│  │   (Hot data, Sessions)  │    │    AI Jobs │ Indexing │ Notifications  │ │
│  └─────────────────────────┘    └─────────────────────────────────────────┘ │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BLOCKCHAIN NODE LAYER                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Rust Aethelred Node                              │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │    │
│  │  │   ABCI/App  │  │  Consensus  │  │   Mempool   │  │ Networking  │ │    │
│  │  │   (PoUW)    │  │  (HotStuff) │  │   (Priority)│  │  (libp2p)   │ │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │    │
│  │  │    Bank     │  │   Staking   │  │  Governance │  │     AI      │ │    │
│  │  │   Module    │  │   Module    │  │   Module    │  │   Module    │ │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │    │
│  │  │    Vault    │  │    Seal     │  │    Model    │  │    WASM     │ │    │
│  │  │   (Liquid   │  │  (Digital   │  │  Registry   │  │  Contracts  │ │    │
│  │  │   Staking)  │  │   Seals)    │  │             │  │             │ │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 📦 Components

### 1. **Blockchain Node** (`/node`)

High-performance Rust implementation of the Aethelred blockchain.

#### Key Features
- **Consensus**: HotStuff-based BFT consensus with sub-3s finality
- **PoUW**: Proof-of-Useful-Work with TEE attestation
- **Throughput**: 2,500+ TPS sustained, 10,000+ TPS burst
- **Modules**: Bank, Staking, Governance, AI Jobs, Vault, Seals, Models, WASM

#### Core Crates
```
node/
├── crates/
│   ├── consensus/         # HotStuff BFT consensus engine
│   ├── hotstuff/          # Core HotStuff implementation
│   ├── bft-core/          # Byzantine fault tolerance primitives
│   ├── tee-verification/  # TEE attestation verification (SGX/TDX/SEV-SNP)
│   └── ai-verification/   # AI inference verification and scoring
├── src/
│   ├── bin/               # Binary entry points
│   ├── consensus/         # Consensus integration
│   ├── execution/         # Transaction execution
│   ├── network/           # P2P networking
│   ├── storage/           # State database
│   ├── crypto/            # Cryptographic primitives
│   ├── vm/                # WASM VM for smart contracts
│   ├── tee/               # TEE integration
│   ├── api/               # ABCI/Tendermint API
│   └── types/             # Core data types
└── tests/                 # Integration tests
```

### 2. **API Gateway** (`/api`)

Production-ready Node.js/TypeScript API for blockchain interaction.

#### Features
- **Protocols**: REST, WebSocket, gRPC
- **Performance**: Sub-50ms p95 response time
- **Caching**: Multi-layer (Redis + in-memory)
- **Rate Limiting**: Token bucket per IP/API key
- **Security**: JWT auth, CORS, Helmet, HPP protection
- **Observability**: OpenTelemetry, Prometheus, Jaeger

#### API Endpoints
```
/v1/blocks              # Block explorer
/v1/transactions        # Transaction history
/v1/validators          # Validator set info
/v1/jobs                # AI job management
/v1/seals               # Digital seals
/v1/models              # Model registry
/v1/vault               # Liquid staking
/v1/governance          # On-chain governance
/v1/staking             # Staking operations
/v1/search              # Global search
/v1/stats               # Network statistics
/v1/accounts            # Account details
```

### 3. **Infrastructure** (`/infra`)

Production Docker Compose and Kubernetes configurations.

#### Services
- **aethelred-node**: Blockchain node
- **api-gateway**: REST/WebSocket API
- **indexer**: Block/transaction indexer
- **postgres**: Primary database
- **redis**: Cache and pub/sub
- **nginx**: Reverse proxy and load balancer
- **prometheus**: Metrics collection
- **grafana**: Visualization dashboards
- **jaeger**: Distributed tracing

## 🚀 Quick Start

### Prerequisites
- Docker 24.0+
- Docker Compose 2.20+
- 16GB+ RAM
- 100GB+ free disk space

### 1. Clone and Configure

```bash
# Clone repository
git clone https://github.com/aethelred/aethelred.git
cd aethelred/backend

# Copy environment file
cp .env.example .env

# Edit configuration
nano .env
```

### 2. Start Infrastructure

```bash
# Build and start all services
docker-compose -f infra/docker-compose.yml up -d

# View logs
docker-compose -f infra/docker-compose.yml logs -f

# Check service health
docker-compose -f infra/docker-compose.yml ps
```

### 3. Verify Installation

```bash
# Check API health
curl http://localhost:3000/health

# Get latest block
curl http://localhost:3000/v1/blocks/latest

# Get network stats
curl http://localhost:3000/v1/stats
```

### 4. Access Services

| Service | URL | Credentials |
|---------|-----|-------------|
| API Docs | http://localhost:3000/docs | - |
| Grafana | http://localhost:3002 | admin/admin |
| Prometheus | http://localhost:9090 | - |
| Jaeger | http://localhost:16686 | - |

## 🔧 Configuration

### Environment Variables

```env
# Node Configuration
CHAIN_ID=aethelred-1
MONIKER=my-validator
MINIMUM_GAS_PRICES=0.025aeth

# Database
DB_USER=aethelred
DB_PASSWORD=secure_password
DB_NAME=aethelred

# Redis
REDIS_URL=redis://localhost:6379

# API
JWT_SECRET=your_jwt_secret_here
RATE_LIMIT_ENABLED=true
CORS_ORIGINS=https://app.aethelred.org

# Monitoring
GRAFANA_USER=admin
GRAFANA_PASSWORD=secure_password
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### Node Configuration

```toml
# config/node/config.toml
[consensus]
block_time = "3s"
timeout_propose = "3s"
timeout_prevote = "1s"
timeout_precommit = "1s"
timeout_commit = "3s"

[p2p]
max_connections = 100
seeds = "seed1.aethelred.org:26656,seed2.aethelred.org:26656"

[mempool]
size = 10000
max_txs_bytes = 1073741824
```

## 📊 Performance Benchmarks

| Metric | Value |
|--------|-------|
| Block Time | 3 seconds |
| Block Size | 10 MB |
| Max TPS | 10,000 |
| Sustained TPS | 2,500 |
| Time to Finality | 3 seconds |
| API Response p50 | 15 ms |
| API Response p95 | 50 ms |
| API Response p99 | 150 ms |
| Validator Set | 200 |

## 🔒 Security

### TEE Attestation
- **Intel SGX**: EPID and DCAP attestation
- **Intel TDX**: Trust Domain Extensions
- **AMD SEV-SNP**: Secure Encrypted Virtualization
- **AWS Nitro Enclaves**: Cloud-native attestation

### Consensus Security
- Byzantine Fault Tolerance: 33% malicious threshold
- Double-signing detection and slashing
- Light client verification

### Network Security
- TLS 1.3 for all communications
- libp2p with Noise protocol encryption
- Rate limiting and DDoS protection

## 🔬 Testing

```bash
# Unit tests
cd backend/node && cargo test --all
cd backend/api && npm test

# Integration tests
docker-compose -f infra/docker-compose.test.yml up --abort-on-container-exit

# Load testing
npm run benchmark

# Fuzz testing
cargo fuzz run block_deserialize
```

## 📚 Documentation

- [API Reference](./api/docs/API.md)
- [Node Operator Guide](./node/docs/OPERATOR.md)
- [Validator Setup](./node/docs/VALIDATOR.md)
- [Smart Contracts](./contracts/README.md)
- [Architecture Decisions](./docs/ADR/)

## 🤝 Contributing

Please read our [Contributing Guidelines](../CONTRIBUTING.md) before submitting PRs.

## 📄 License

Apache 2.0 - see [LICENSE](../LICENSE) for details.

## 🌐 Resources

- **Website**: https://aethelred.org
- **Documentation**: https://docs.aethelred.org
- **Explorer**: https://explorer.aethelred.org
- **Discord**: https://discord.gg/aethelred
- **Twitter**: https://twitter.com/aethelred

---

<p align="center">
  <strong>Built with ❤️ by Aethelred Labs</strong>
</p>
