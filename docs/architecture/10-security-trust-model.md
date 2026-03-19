# Track 10: Security Trust Model & Threat Model

## Overview

This document defines the security trust boundaries, threat model, and mitigation strategies for the Cruzible liquid staking protocol. It covers the full stack: smart contracts (EVM), Cosmos SDK keeper, TEE enclaves, relayer services, and the frontend dApp.

---

## 1. Trust Boundaries

### 1.1 Trust Hierarchy

```
Layer 0:   Hardware TEE (Intel SGX / AWS Nitro / AMD SEV)
  └─ Layer 0.5: Attestation Relay Bridge (trusted off-chain P-256 signer)
       └─ Layer 1: TEE Enclave Application (Rust server)
            └─ Layer 2: Cosmos SDK Module (Go keeper)
                 └─ Layer 3: EVM Smart Contracts (Solidity)
                      └─ Layer 4: Backend API Gateway (Node.js)
                           └─ Layer 5: Frontend dApp (React/Next.js)
```

| Layer                   | Trust Level           | Compromise Impact                           | Recovery                                                                          |
| ----------------------- | --------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| L0: TEE Hardware        | Root of trust         | Total protocol compromise                   | Vendor root key rotation                                                          |
| L0.5: Attestation Relay | High (trusted bridge) | Forged platform keys, enclave impersonation | Governance revocation (`revokeRelay`), 48h rotation timelock, liveness challenges |
| L1: Enclave App         | High (attested)       | Validator selection manipulation            | Enclave revocation + re-attestation                                               |
| L2: Cosmos Keeper       | High (consensus)      | State corruption, fund theft                | Governance halt + state rollback                                                  |
| L3: EVM Contracts       | High (immutable)      | Fund theft, reward manipulation             | Timelock + upgrade proxy                                                          |
| L4: Backend API         | Medium (auxiliary)    | Data inconsistency, DoS                     | Redundancy, no fund access                                                        |
| L5: Frontend            | Low (untrusted)       | Phishing, UI manipulation                   | User verification, wallet confirmation                                            |

### 1.2 Trust Assumptions

1. **TEE hardware is sound**: We assume that the underlying hardware (Intel SGX, AWS Nitro, AMD SEV) has not been subject to a root-key compromise or side-channel break that voids attestation guarantees. Mitigation: Multi-vendor support (SGX + Nitro + SEV), and the ability to revoke and rotate vendor root keys on-chain.

2. **Attestation relay bridge is trusted**: The production attestation flow does **not** verify raw hardware evidence directly on-chain. Instead, a **trusted attestation relay** verifies the hardware chain of trust off-chain (DCAP quote, Nitro document, SEV-SNP report) and signs the platform key binding with its own P-256 key. The relay's public key is registered on-chain via `VaultTEEVerifier.registerAttestationRelay()` with the following governance controls:
   - **Time-locked key rotation** (48-hour delay via `initiateRelayRotation` / `finalizeRelayRotation`)
   - **On-chain liveness challenges** with P-256 proof-of-possession (`challengeRelay` / `respondRelayChallenge`, 1-hour window)
   - **Emergency revocation** by governance (`revokeRelay`, zeroes `vendorRootKey`, blocks new registrations)
   - **Attestation counting and audit trail** (on-chain `attestationCount`)

   **Risk**: If the relay is compromised, it could certify arbitrary platform keys. The governance controls enable detection, containment, and recovery — but the relay is part of the trusted computing base and its compromise constitutes a protocol-level security event.

3. **Cosmos consensus is honest**: 2/3+ of validators are honest. Mitigation: Standard BFT assumption, slashing for misbehavior.

4. **Telemetry relayer is untrusted**: The off-chain relayer that submits telemetry and triggers validator selection is treated as potentially malicious. Mitigations: attestation binding, universe hashing, quorum checks. (Note: this is a separate trust boundary from the attestation relay in assumption #2.)

5. **Users verify transactions in wallet**: The frontend is untrusted; users must verify transaction details in their wallet before signing.

---

## 2. Threat Model

### 2.1 Smart Contract Threats (EVM)

| Threat                               | Severity | Likelihood | Mitigation                                                       |
| ------------------------------------ | -------- | ---------- | ---------------------------------------------------------------- |
| Reentrancy on stake/unstake          | Critical | Low        | CEI pattern, ReentrancyGuard                                     |
| Exchange rate manipulation           | Critical | Medium     | Oracle-independent rate (shares/pooled), no external price feeds |
| Flash loan attack on governance      | High     | Medium     | Timelock on parameter changes, no same-block voting              |
| Overflow/underflow                   | High     | Low        | Solidity 0.8+ built-in checks                                    |
| Front-running of validator selection | Medium   | Medium     | Attestation payload binding prevents manipulation                |
| Denial of service (gas griefing)     | Medium   | Medium     | Gas limits, batch size caps                                      |

### 2.2 Cosmos Keeper Threats

| Threat                       | Severity | Likelihood | Mitigation                                     |
| ---------------------------- | -------- | ---------- | ---------------------------------------------- |
| Unauthorized pause/unpause   | Critical | Low        | Authority-gated, audit log                     |
| Malicious parameter update   | High     | Low        | Governance-only, parameter validation          |
| Stale telemetry injection    | High     | Medium     | Timestamp freshness checks, quorum requirement |
| Selective telemetry omission | High     | Medium     | MinTelemetryQuorumPct (67%), universe hash     |
| Nonce replay on attestation  | High     | Low        | UsedNonces dedup map, 5-minute freshness       |
| State corruption via JSON    | Medium   | Low        | Validated deserialization, type safety         |
| Epoch skipping               | Medium   | Low        | Sequential epoch enforcement                   |
| Circuit breaker evasion      | Medium   | Low        | Atomic threshold checks in same transaction    |

### 2.3 TEE Enclave Threats

| Threat                                | Severity | Likelihood | Mitigation                                    |
| ------------------------------------- | -------- | ---------- | --------------------------------------------- |
| Enclave key extraction (side channel) | Critical | Very Low   | Hardware mitigations, attestation freshness   |
| Fake enclave registration             | Critical | Low        | Vendor root key attestation (P-256 chain)     |
| Operator key compromise               | High     | Low        | Per-operator binding, revocation support      |
| Stale attestation replay              | High     | Medium     | 5-minute freshness, nonce uniqueness          |
| Platform-specific bypass              | Medium   | Low        | Multi-platform verification (SGX, Nitro, SEV) |

### 2.4 Attestation Relay Threats

The attestation relay is part of the trusted computing base (see Trust Assumption #2). It verifies hardware evidence off-chain and signs platform key bindings. The following threats are specific to this trust boundary:

| Threat                                      | Severity | Likelihood | Mitigation                                                                           |
| ------------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------ |
| Relay key compromise (forged attestations)  | Critical | Low        | 48h rotation timelock, governance revocation, liveness challenges                    |
| Relay certifies arbitrary platform keys     | Critical | Low        | Attestation counting/audit trail, liveness challenges with P-256 proof-of-possession |
| Relay liveness failure (stale attestations) | High     | Medium     | On-chain liveness challenges (1h window), emergency revocation                       |
| Relay key rotation hijack                   | High     | Low        | 48h timelock on `finalizeRelayRotation`, governance cancel                           |

### 2.5 Telemetry Relayer/Bridge Threats

The telemetry relayer (which submits validator telemetry and triggers selection) is treated as untrusted:

| Threat                           | Severity | Likelihood | Mitigation                                     |
| -------------------------------- | -------- | ---------- | ---------------------------------------------- |
| Malicious validator set proposal | Critical | Medium     | TEE attestation binding, on-chain verification |
| Selective data withholding       | High     | Medium     | Quorum checks, universe hash                   |
| Eclipse attack on relayer        | High     | Low        | Multiple RPC endpoints, peer diversity         |
| Transaction censorship           | Medium   | Medium     | Multiple relayer operators, public mempool     |

### 2.6 Frontend/API Threats

| Threat          | Severity | Likelihood | Mitigation                                           |
| --------------- | -------- | ---------- | ---------------------------------------------------- |
| XSS injection   | High     | Medium     | CSP headers, React auto-escaping, input sanitization |
| CSRF            | Medium   | Low        | SameSite cookies, CORS whitelist                     |
| API abuse/DDoS  | Medium   | High       | Rate limiting, per-user throttling                   |
| JWT token theft | Medium   | Medium     | Short expiry (15m access), HttpOnly refresh          |
| DNS hijacking   | High     | Low        | DNSSEC, HSTS preload                                 |

### 2.7 Stablecoin Bridge Threats (InstitutionalStablecoinBridge)

The stablecoin bridge enables cross-chain USDC/USDT transfers via CCTP and TEE-attested minting. It introduces additional threat surfaces beyond the core vault:

| Threat                                            | Severity | Likelihood | Mitigation                                                                                                    |
| ------------------------------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| Circuit breaker bypass (rate limit evasion)       | Critical | Low        | Atomic per-transaction checks in `bridgeOutViaCCTP`, hourly/daily BPS caps enforced in same call              |
| CCTP relay failure (stuck funds)                  | High     | Medium     | Frontend displays pending status; CCTP nonce tracking; manual relay fallback                                  |
| Proof-of-reserve oracle stale/manipulated         | High     | Medium     | `porHeartbeatSeconds` staleness check, `porDeviationBps` tolerance, `ReserveCheckPerformed` event audit trail |
| Daily limit exhaustion (DoS via many small burns) | Medium   | Medium     | Per-epoch `mintCeilingPerEpoch` + `dailyTxLimit` caps; reconciliation alert at 80% usage                      |
| Unauthorized config change                        | Critical | Low        | `configureStablecoin` restricted to bridge admin role; governance timelock recommended                        |
| Indexer misses bridge events                      | Medium   | Low        | Idempotent upserts `@@unique([txHash, logIndex])`; reconciliation scheduler detects config drift              |
| Decimal mismatch (6 vs 18)                        | High     | Low        | Asset registry enforces `decimals: 6` for USDC/USDT; `parseUnits(amount, asset.decimals)` used everywhere     |

---

## 3. Emergency Response Procedures

### 3.1 Severity Levels

| Level | Definition                                     | Response Time | Authority                              |
| ----- | ---------------------------------------------- | ------------- | -------------------------------------- |
| SEV-0 | Active fund theft or total protocol compromise | Immediate     | Any team member can trigger PauseVault |
| SEV-1 | Potential exploit discovered, no active theft  | < 1 hour      | Security team triggers PauseVault      |
| SEV-2 | Data inconsistency, non-critical bug           | < 24 hours    | Engineering team investigates          |
| SEV-3 | Minor issue, no user impact                    | Next sprint   | Standard development workflow          |

### 3.2 Emergency Pause Procedure

1. **Trigger**: `PauseVault(ctx, authority, reason)` — blocks all mutating operations
2. **Assess**: Determine scope of the issue using operator audit log and on-chain state
3. **Mitigate**: Deploy fix (contract upgrade via timelock, keeper patch via governance)
4. **Unpause**: `UnpauseVault(ctx, authority, reason)` after fix is verified
5. **Post-mortem**: Document root cause, timeline, and preventive measures

### 3.3 Circuit Breaker Auto-Pause

The circuit breaker automatically pauses the vault when:

- Unstake volume exceeds `MaxUnstakePerEpochPct` of TVL in a single epoch
- Slash count exceeds `MaxSlashesPerEpoch` in a single epoch

Recovery requires governance `UnpauseVault` after the triggering condition is investigated.

---

## 4. Audit Checklist

### 4.1 Smart Contract Audit Scope

- [ ] Cruzible.sol: stake, unstake, withdraw, claimRewards, applyValidatorSelection
- [ ] StAETHEL.sol: ERC-20 compliance, mint/burn access control
- [ ] TimelockController: delay enforcement, proposal execution
- [ ] Exchange rate calculation: rounding, overflow, edge cases
- [ ] Access control: onlyOwner, onlyGovernance, onlyKeeper roles

### 4.2 Keeper Audit Scope

- [ ] Pause/unpause authority checks
- [ ] Circuit breaker threshold calculations
- [ ] TEE attestation verification (all 3 platforms)
- [ ] Vendor root key attestation chain
- [ ] Nonce uniqueness enforcement
- [ ] Delegation snapshot temporal consistency
- [ ] Validator set hash cross-layer agreement

### 4.3 TEE Audit Scope

- [ ] Enclave measurement reproducibility
- [ ] Side-channel resistance (constant-time operations)
- [ ] Key generation entropy
- [ ] Attestation payload construction
- [ ] Memory isolation verification

---

## 5. Key Management

| Key Type                   | Purpose                                                            | Storage                                                        | Rotation                                                                                                   |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Attestation relay P-256    | Signs platform key bindings after verifying hardware evidence      | On-chain via `registerAttestationRelay()`                      | 48h timelock via `initiateRelayRotation` / `finalizeRelayRotation`; emergency revocation via `revokeRelay` |
| Vendor root P-256 (legacy) | Direct TEE hardware attestation (fallback when no relay is active) | On-chain via `setVendorRootKey()` (blocked while relay active) | On vendor key compromise                                                                                   |
| Platform P-256             | Per-enclave signing                                                | Inside TEE enclave                                             | On enclave upgrade                                                                                         |
| Operator secp256k1         | Attestation signing                                                | Operator HSM/enclave                                           | On operator rotation                                                                                       |
| JWT signing key            | API authentication                                                 | Environment variable                                           | Every 90 days                                                                                              |
| Governance multisig        | Parameter changes                                                  | Hardware wallets                                               | On member rotation                                                                                         |

---

## 6. Accepted Architectural Residuals

The following are **known trust dependencies** that have been reviewed and accepted for the current architecture. Each residual is classified as either _temporary_ (to be removed before or shortly after mainnet) or _permanent_ (an inherent property of the architecture).

### 6.1 Trusted Attestation Relay (Permanent)

**Description**: The attestation relay bridge (Layer 0.5) is part of the trusted computing base. It verifies raw hardware attestation evidence off-chain (DCAP, Nitro, SEV-SNP) and signs platform key bindings with its own P-256 key. A compromise of the relay private key allows forging attestations for arbitrary enclave platform keys.

**Justification**: On-chain verification of raw vendor attestation evidence is infeasible due to gas costs, platform diversity (three vendors), and the need for access to vendor CRL/OCSP endpoints. The relay centralizes this complexity in a single auditable component.

**Mitigations in place**:

- 48-hour rotation timelock prevents silent key swaps
- On-chain liveness challenges with P-256 proof-of-possession detect relay compromise
- Governance revocation zeroes the relay key and blocks new registrations
- Attestation counting provides an on-chain audit trail

**Acceptance**: Permanent — relay is an inherent architectural component. The governance controls reduce residual risk to an acceptable level, but the relay remains a single point of failure that requires operational vigilance.

### 6.2 Trusted Keeper ↔ TEE Bridge (Permanent)

**Description**: The Cosmos SDK keeper trusts the EVM contract's attestation verification results via cross-layer validator-set hash agreement. If the EVM contract or keeper is compromised, the other layer cannot independently detect the compromise in real time.

**Justification**: Cross-layer verification is by design — the Cosmos module and EVM contracts form a layered security model where each layer validates its own invariants. Full cross-layer proofs would require an on-chain light client, which is not yet feasible.

**Mitigations in place**:

- Validator set hash is compared across layers at every epoch boundary
- Circuit breaker halts the vault on anomalous unstake/slash volume
- Reconciliation scheduler detects TVL drift, exchange rate anomalies, and epoch staleness

**Acceptance**: Permanent — inherent to the cross-chain architecture. External audit should verify the cross-layer hash agreement logic.

### 6.3 Governance Feeder-Set Admin Control (Temporary)

**Description**: The governance oracle's feeder set (the 3-of-5 quorum that submits price/parameter data) is currently managed by admin-only `add_feeder` / `remove_feeder` operations. There is no on-chain mechanism for the community to elect or remove feeders.

**Justification**: Pre-mainnet simplification. The feeder set must be tightly controlled during initial deployment to prevent manipulation of governance parameters. Decentralized feeder election will be introduced in a governance v2 upgrade.

**Mitigations in place**:

- Oracle epoch invalidation prevents stale feeder submissions after rotation
- Ambiguity guard rejects submissions where 2+ feeders report identical values
- Sliding window consensus with true median is resistant to single-feeder manipulation
- 3-of-5 quorum ensures no single feeder can drive consensus

**Acceptance**: Temporary — to be replaced with on-chain feeder election before or during Phase 4 (full launch). Tracked in governance contract TODO.

---

## 7. Compliance Considerations

- **GDPR**: No PII stored on-chain. Addresses are pseudonymous. Backend logs are retained max 30 days.
- **OFAC**: Recommend integration with Chainalysis or TRM Labs for address screening before large stakes.
- **SOC 2**: Backend API logging, access controls, and audit trails support SOC 2 Type II compliance.
