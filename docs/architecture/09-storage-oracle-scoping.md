# Track 9: Storage & Oracle Scoping

## Overview

This document defines the storage architecture and oracle integration patterns for the Cruzible liquid staking protocol. It covers on-chain state management, off-chain data ingestion, and the oracle pipeline that feeds validator telemetry into the TEE scoring engine.

---

## 1. On-Chain Storage Model

### 1.1 Storage Backend

Cruzible uses **Cosmos SDK collections** (`cosmossdk.io/collections`) backed by the IAVL+ KVStore. All state is deterministic, crash-safe, and Merkle-provable.

### 1.2 State Schema

| Prefix | Collection Type    | Key              | Value                     | Purpose                     |
| ------ | ------------------ | ---------------- | ------------------------- | --------------------------- |
| 0      | Item[string]       | —                | JSON VaultParams          | Protocol parameters         |
| 1      | Map[string,string] | address          | JSON StakerRecord         | Staker positions            |
| 2      | Map[string,string] | address          | JSON ValidatorRecord      | Validator state + telemetry |
| 3      | Map[string,string] | withdrawalID     | JSON WithdrawalRequest    | Unbonding queue             |
| 4      | Map[string,string] | epoch            | JSON EpochSnapshot        | Epoch history               |
| 5      | Map[string,uint64] | epoch            | total staked              | Per-epoch rate limiter      |
| 6      | Map[string,string] | addr:epoch       | "true"                    | Reward claim dedup          |
| 7      | Item[uint64]       | —                | uint64                    | Total pooled AETHEL         |
| 8      | Item[uint64]       | —                | uint64                    | Total shares (stAETHEL)     |
| 9      | Item[uint64]       | —                | uint64                    | Current epoch counter       |
| 10     | Item[uint64]       | —                | uint64                    | Next withdrawal ID          |
| 11     | Item[uint64]       | —                | uint64                    | Total pending withdrawals   |
| 12     | Item[uint64]       | —                | uint64                    | Total MEV revenue           |
| 13     | Item[string]       | —                | JSON string[]             | Active validator addresses  |
| 14     | Map[string,string] | address          | JSON uint64[]             | User withdrawal IDs         |
| 15     | Map[string,string] | enclaveID        | JSON EnclaveRegistration  | TEE enclave registry        |
| 16     | Map[string,string] | pubKeyHex        | JSON OperatorRegistration | TEE operator registry       |
| 17     | Map[string,string] | nonce            | "used"                    | Attestation nonce dedup     |
| 18     | Map[string,string] | platformId       | JSON {X, Y}               | Vendor root P-256 keys      |
| 19     | Map[string,string] | epoch            | JSON DelegationSnapshot   | Epoch delegation state      |
| 20     | Item[string]       | —                | JSON PauseState           | Emergency pause state       |
| 21     | Item[string]       | —                | JSON CircuitBreakerConfig | Circuit breaker config      |
| 22     | Map[string,uint64] | epoch            | cumulative unstake        | CB unstake accumulator      |
| 23     | Map[string,uint64] | epoch            | slash count               | CB slash counter            |
| 24     | Map[string,string] | timestamp_action | JSON OperatorAction       | Operator audit log          |

### 1.3 Serialization

All complex types are JSON-serialized into string values. This provides:

- **Human readability** in state dumps
- **Schema evolution** (add fields without migration)
- **Cross-language compatibility** (JSON is universal)

Trade-off: ~2x storage overhead vs protobuf. Acceptable at current state size (<100MB projected at 100K stakers).

### 1.4 State Growth Projections

| Entity          | Count (Year 1) | Record Size | Total       |
| --------------- | -------------- | ----------- | ----------- |
| Stakers         | 100,000        | ~300 bytes  | 30 MB       |
| Validators      | 200            | ~500 bytes  | 100 KB      |
| Withdrawals     | 500,000        | ~200 bytes  | 100 MB      |
| Epoch snapshots | 365            | ~500 bytes  | 182 KB      |
| Nonces          | 50,000         | ~70 bytes   | 3.5 MB      |
| **Total**       |                |             | **~135 MB** |

### 1.5 Pruning Strategy

- **Withdrawals**: Claimed withdrawals can be pruned after 30 epochs (30 days) via governance proposal
- **Nonces**: Can be pruned after `MaxAttestationAgeSec` (5 minutes), but keeping 24h for audit
- **Epoch snapshots**: Keep all (small, valuable for analytics)
- **Delegation snapshots**: Keep last 7 epochs, prune older

---

## 2. Oracle Architecture

### 2.1 Data Flow

```
External Monitoring    Aethelred Oracle SDK     Cosmos Chain     TEE Enclave
  (Grafana/DD)    -->  OracleClient.submit()  --> keeper.Update   --> scoring
                       W3C VC attestation         ValidatorTelemetry()
```

### 2.2 Telemetry Oracle

The primary oracle use case is **validator telemetry ingestion**:

| Field                  | Source                  | Update Frequency  | Staleness Threshold |
| ---------------------- | ----------------------- | ----------------- | ------------------- |
| `uptime_pct`           | Monitoring (Prometheus) | Every epoch (24h) | 48h (2x epoch)      |
| `avg_response_ms`      | Load balancer metrics   | Every epoch       | 48h                 |
| `total_jobs_completed` | Job indexer             | Every epoch       | 48h                 |
| `country_code`         | IP geolocation          | On registration   | Never stale         |

### 2.3 Oracle Security Model

**Threat: Malicious relayer selectively omits telemetry to bias validator selection.**

Mitigations:

1. **Quorum requirement**: `MinTelemetryQuorumPct` (default 67%) of active validators must have fresh telemetry, or `BuildValidatorSelectionRequest()` rejects
2. **Staleness detection**: Validators with telemetry older than `TelemetryMaxAgeSec` are excluded from the TEE candidate set
3. **Universe hash binding**: The attestation payload includes `eligible_universe_hash` (SHA-256 of sorted eligible addresses), so the TEE can verify it received the full candidate set
4. **Policy hash binding**: The selection config weights/thresholds are hashed and bound to the attestation

### 2.4 Future Oracle Extensions

| Oracle Feed                   | Priority | Purpose                        |
| ----------------------------- | -------- | ------------------------------ |
| AETHEL/USD price              | P1       | TVL display, fee estimation    |
| Gas price oracle              | P1       | Transaction cost estimation    |
| Slashing events (cross-chain) | P2       | Proactive validator monitoring |
| MEV revenue oracle            | P2       | Real-time MEV redistribution   |
| Hardware attestation refresh  | P3       | Periodic re-attestation        |

### 2.5 Oracle Integration Pattern

```typescript
// Recommended oracle submission pattern (relayer service)
import { OracleClient, ProvenanceIssuer } from '@aethelred/sdk';

const oracle = new OracleClient(rpcUrl);
const issuer = new ProvenanceIssuer(signingKey);

// 1. Collect telemetry from monitoring
const telemetry = await fetchFromPrometheus(validatorAddr);

// 2. Create verifiable credential
const vc = await issuer.createCredential({
  type: 'OracleDataAttestation',
  subject: { validatorAddr, ...telemetry },
});

// 3. Submit on-chain via MsgUpdateValidatorTelemetry
await cosmosClient.signAndBroadcast([
  { typeUrl: '/aethelred.vault.MsgUpdateValidatorTelemetry', value: { ... } }
]);
```

---

## 3. Off-Chain Indexed Storage

### 3.1 PostgreSQL Schema (via Prisma)

The backend indexer materializes on-chain events into PostgreSQL for fast querying:

- **VaultState**: Latest vault metrics (TVL, shares, exchange rate, APY)
- **VaultStake**: Staking event history
- **VaultUnstake**: Unstaking events with completion timestamps
- **VaultWithdrawal**: Withdrawal completions
- **VaultReward**: Epoch reward distributions
- **StAethelBalance**: Current stAETHEL balances per address

### 3.2 Reconciliation

The `ReconciliationScheduler` (Track 7) continuously validates consistency between:

- On-chain state (via CosmJS/RPC)
- Indexed PostgreSQL state
- EVM contract state (via ethers.js)

Drift alerts fire when values diverge beyond configurable thresholds.

---

## 4. Recommendations

1. **Short-term (pre-launch)**:
   - Deploy telemetry oracle relayer as a separate service
   - Set `MinTelemetryQuorumPct` to 50% initially, increase to 67% after validator onboarding
   - Enable circuit breaker with 25% unstake threshold

2. **Medium-term (post-launch)**:
   - Integrate Chainlink price feed for AETHEL/USD display
   - Add Redis as CacheService backend (replace in-memory map)
   - Implement withdrawal pruning cronjob

3. **Long-term**:
   - Move to protobuf serialization if state exceeds 1GB
   - Add historical oracle data indexing for analytics
   - Implement oracle reputation scoring (penalize stale/inaccurate data providers)
