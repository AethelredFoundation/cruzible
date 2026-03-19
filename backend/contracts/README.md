# Aethelred Smart Contracts

> Production-grade CosmWasm smart contracts for the Aethelred sovereign AI verification network.

## 📋 Contract Overview

| Contract           | Purpose                  | Key Features                                  |
| ------------------ | ------------------------ | --------------------------------------------- |
| **AI Job Manager** | Manage AI inference jobs | Job lifecycle, TEE attestation, payments      |
| **Seal Manager**   | Digital attestations     | Cryptographic seals, verification, revocation |
| **Model Registry** | AI model registration    | Model metadata, verification, categories      |
| **Governance**     | On-chain governance      | Proposals, voting, execution                  |
| **AethelVault**    | Liquid staking           | Stake AETHEL, mint stAETHEL                   |
| **CW20 Staking**   | Staking token            | CW20-compliant stAETHEL token                 |

## 🏗️ Contract Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SMART CONTRACT LAYER                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │   AI Job        │    │    Seal         │    │    Model        │      │
│  │   Manager       │◄──►│   Manager       │    │   Registry      │      │
│  │                 │    │                 │    │                 │      │
│  │ • Submit jobs   │    │ • Create seals  │    │ • Register      │      │
│  │ • Assign work   │    │ • Revoke seals  │    │ • Verify        │      │
│  │ • TEE verify    │    │ • Batch verify  │    │ • Categories    │      │
│  │ • Distribute    │    │ • Expiration    │    │ • Versions      │      │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘      │
│           │                      │                      │               │
│           ▼                      ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      AethelVault (Liquid Staking)                │   │
│  │                                                                  │   │
│  │  • Stake AETHEL ◄───► Mint stAETHEL (CW20)                      │   │
│  │  • Unbonding period (21 days)                                   │   │
│  │  • Auto-compounding rewards                                      │   │
│  │  • Multi-validator delegation                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│           ▲                                                            │
│           │                                                            │
│  ┌────────┴────────┐    ┌─────────────────┐                           │
│  │  CW20 Staking   │    │   Governance    │                           │
│  │   (stAETHEL)    │    │                 │                           │
│  │                 │    │ • Proposals     │                           │
│  │ • ERC20-compat  │    │ • Voting        │                           │
│  │ • Transfer      │    │ • Execution     │                           │
│  │ • Allowances    │    │ • Quorum 33.4%  │                           │
│  │ • Burn/Mint     │    │ • Threshold 50% │                           │
│  └─────────────────┘    └─────────────────┘                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 📦 Contract Details

### 1. AI Job Manager (`ai_job_manager`)

**Purpose**: Core contract for managing verifiable AI inference jobs.

**Key Messages**:

```rust
// Submit a new AI job
SubmitJob {
    model_hash: String,
    input_hash: String,
    proof_type: ProofType,  // TEE, ZK, MPC, Optimistic
    priority: u32,
    timeout: u64,  // blocks
}

// Validator assigns themselves to job
AssignJob { job_id: String }

// Submit completed job with TEE attestation
CompleteJob {
    job_id: String,
    output_hash: String,
    tee_attestation: TEEAttestation,
    compute_metrics: ComputeMetrics,
}

// Claim payment for verified job
ClaimPayment { job_id: String }
```

**State**:

- Job records with status tracking
- Pending job queue (by priority)
- Validator statistics

**Pricing**:

```rust
Cost = base_cost(cpu_cycles) + memory_cost(memory_mb) + priority_multiplier
```

---

### 2. Seal Manager (`seal_manager`)

**Purpose**: Creates and manages digital seals (verifiable attestations) for AI outputs.

**Key Messages**:

```rust
// Create a new seal for verified output
CreateSeal {
    job_id: String,
    model_commitment: String,   // Hash of model
    input_commitment: String,   // Hash of input
    output_commitment: String,  // Hash of output
    validator_addresses: Vec<String>,  // 3-10 validators
    expiration: Option<u64>,  // seconds
}

// Revoke a seal (creator only)
RevokeSeal { seal_id: String, reason: String }

// Verify seal validity
VerifySeal { seal_id: String }

// Create new seal that supersedes old
SupersedeSeal { old_seal_id: String, ... }
```

**Seal States**:

- `Active` - Valid and verifiable
- `Revoked` - Manually revoked
- `Expired` - Past expiration time
- `Superseded` - Replaced by newer seal

---

### 3. Model Registry (`model_registry`)

**Purpose**: Register and manage AI models available for inference.

**Key Messages**:

```rust
// Register a new model
RegisterModel {
    name: String,
    model_hash: String,  // Unique identifier
    architecture: String, // e.g., "transformer-large"
    version: String,
    category: ModelCategory,  // Medical, Financial, etc.
    input_schema: String,   // JSON schema
    output_schema: String,  // JSON schema
    storage_uri: String,    // IPFS/Arweave link
    size_bytes: Option<u64>,
}

// Verify model (authorized verifiers)
VerifyModel { model_hash: String }

// Update model metadata (owner only)
UpdateModel {
    model_hash: String,
    name: Option<String>,
    storage_uri: Option<String>,
}
```

**Categories**:

- `General`
- `Medical`
- `Scientific`
- `Financial`
- `Legal`
- `Educational`
- `Environmental`

---

### 4. Governance (`governance`)

**Purpose**: On-chain governance for protocol parameters and upgrades.

**Key Messages**:

```rust
// Submit proposal
SubmitProposal {
    title: String,
    description: String,
    messages: Vec<CosmosMsg>,  // Execution messages
}

// Vote on proposal
Vote {
    proposal_id: u64,
    option: VoteOption,  // Yes, No, Abstain, NoWithVeto
}

// Execute passed proposal
ExecuteProposal { proposal_id: u64 }
```

**Voting Parameters**:

- Voting Period: 14 days
- Quorum: 33.4% of staked tokens
- Pass Threshold: 50% of participating votes
- Veto Threshold: 33.4% NoWithVeto

---

### 5. AethelVault (`vault`)

**Purpose**: Liquid staking - stake AETHEL, receive stAETHEL.

**Key Messages**:

```rust
// Stake AETHEL, receive stAETHEL
Stake {}

// Start unstaking (21-day unbonding)
Unstake { share_amount: Uint128 }

// Claim unstaked AETHEL after unbonding
ClaimUnstaked { request_id: u64 }

// Claim staking rewards
ClaimRewards {}
```

**Exchange Rate**:

```
Exchange Rate = Total Staked / Total Shares

Example:
- Total Staked: 1,000,000 AETHEL
- Total Shares: 920,000 stAETHEL
- Rate: 1.087 AETHEL per stAETHEL
```

**Unstaking Flow**:

1. Burn stAETHEL
2. Create unstake request
3. Wait 21 days (unbonding period)
4. Claim AETHEL

---

### 6. CW20 Staking Token (`cw20_staking`)

**Purpose**: CW20-compliant token contract for stAETHEL.

**Features**:

- Full CW20 standard (transfer, approve, transfer_from, etc.)
- Mintable by vault contract only
- Burnable for unstaking
- Queryable balance and allowances

**Instantiation**:

```json
{
  "name": "Staked AETHEL",
  "symbol": "stAETHEL",
  "decimals": 6,
  "initial_supply": "0",
  "minter": "aethel-vault-contract",
  "cap": "1000000000000000"
}
```

## 🔧 Building and Deploying

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install wasm target
rustup target add wasm32-unknown-unknown

# Install CosmWasm tools
cargo install cargo-generate --features cargo-generate/cargo-install
cargo install cargo-wasm
```

### Build Contracts

```bash
cd backend/contracts

# Build all contracts
cargo build --release --target wasm32-unknown-unknown

# Optimize for deployment
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.14.0
```

### Deploy

```bash
# Upload contract code
wasmd tx wasm store artifacts/ai_job_manager.wasm \
  --from validator \
  --chain-id aethelred-1 \
  --gas auto \
  --gas-adjustment 1.3

# Instantiate
wasmd tx wasm instantiate 1 '{"payment_denom":"aeth","min_timeout":100,...}' \
  --from validator \
  --label "AI Job Manager" \
  --chain-id aethelred-1
```

## 📊 Contract Addresses (Mainnet)

| Contract        | Address    | Code ID |
| --------------- | ---------- | ------- |
| AI Job Manager  | `aeth1...` | 1       |
| Seal Manager    | `aeth1...` | 2       |
| Model Registry  | `aeth1...` | 3       |
| Governance      | `aeth1...` | 4       |
| AethelVault     | `aeth1...` | 5       |
| stAETHEL (CW20) | `aeth1...` | 6       |

## 🔒 Security Considerations

### Access Control

- Admin functions restricted to contract admin
- Minter role restricted to vault contract
- Verifier role for model verification

### Validation

- All inputs validated (length, format)
- Addresses validated using `deps.api.addr_validate()`
- Arithmetic overflow protection (Uint128 checked math)

### Economic Security

- Minimum deposits for proposals
- Slashing for invalid attestations
- Fee mechanism to prevent spam

## 🧪 Testing

```bash
# Unit tests
cargo test --all

# Integration tests
cargo test --features integration

# Gas benchmarks
cargo bench
```

## 📚 Dependencies

```toml
[dependencies]
cosmwasm-std = "1.5"
cosmwasm-storage = "1.5"
cw-storage-plus = "1.2"
cw2 = "1.1"
cw20 = "1.1"
serde = { version = "1.0", default-features = false }
schemars = "0.8"
sha2 = "0.10"
thiserror = "1.0"
```

## 🤝 Contributing

1. Follow CosmWasm best practices
2. Add comprehensive tests
3. Update documentation
4. Run clippy: `cargo clippy --all-targets --all-features -- -D warnings`

## 📄 License

Apache 2.0 - See [LICENSE](../../LICENSE)
