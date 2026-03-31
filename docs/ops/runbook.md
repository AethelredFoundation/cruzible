# Cruzible Operations Runbook

> Operational procedures for the Cruzible liquid staking protocol.
> All procedures assume access to the monorepo and appropriate credentials.

---

## 1. Deploy

### 1.1 Smart Contracts (CosmWasm)

```bash
# Build optimized WASM
cd backend/contracts
./cargo-isolated.sh build --release --target wasm32-unknown-unknown

# Upload to chain
aethelredd tx wasm store target/wasm32-unknown-unknown/release/governance.wasm \
  --from deployer --gas auto --gas-adjustment 1.3

# Instantiate
aethelredd tx wasm instantiate <CODE_ID> '{"admin":"aethelred1..."}' \
  --from deployer --label "governance-v1" --no-admin
```

### 1.2 Backend API

```bash
cd backend/api

# Build
npm ci --production
npm run build

# Docker
docker build -t aethelred/cruzible-api:latest .
docker push aethelred/cruzible-api:latest

# Kubernetes
kubectl set image deployment/cruzible-api \
  api=aethelred/cruzible-api:latest \
  -n cruzible
```

### 1.3 Frontend

```bash
cd dApps/cruzible

npm ci
npm run build
# Deploy to CDN / Vercel / static host
```

---

## 2. Rollback

### 2.1 Backend API Rollback

```bash
# Find the previous image tag
kubectl rollout history deployment/cruzible-api -n cruzible

# Roll back to the previous revision
kubectl rollout undo deployment/cruzible-api -n cruzible

# Verify
kubectl rollout status deployment/cruzible-api -n cruzible
```

### 2.2 Smart Contract Rollback

Smart contracts are immutable on-chain. For upgradeable contracts (proxy pattern):

```bash
# 1. Pause the vault (blocks all mutating operations)
aethelredd tx wasm execute <VAULT_ADDR> '{"pause":{}}' --from admin

# 2. Upload the previous version
aethelredd tx wasm store <PREVIOUS_WASM> --from deployer

# 3. Migrate the contract
aethelredd tx wasm migrate <CONTRACT_ADDR> <NEW_CODE_ID> '{"migrate":{}}' --from admin

# 4. Verify state consistency
aethelredd query wasm contract-state smart <CONTRACT_ADDR> '{"vault_state":{}}'

# 5. Unpause
aethelredd tx wasm execute <VAULT_ADDR> '{"unpause":{}}' --from admin
```

### 2.3 Database Rollback

```bash
cd backend/api

# Check migration history
npx prisma migrate status

# Roll back (manual — Prisma doesn't support automatic rollback)
# Apply the reverse migration SQL manually
psql $DATABASE_URL < prisma/migrations/<TIMESTAMP>_rollback.sql
```

---

## 3. Reindex

When the IndexerService falls behind or detects a reorg:

### 3.1 Partial Reindex (Resume from Last Known Good Block)

```bash
# Check current indexer status
curl http://localhost:3001/health/ready | jq '.checks.indexer'

# The IndexerService automatically handles reorgs by:
# 1. Detecting parent-hash mismatches
# 2. Walking back to the fork point
# 3. Deleting orphaned blocks and re-indexing

# To force a reindex from a specific block:
curl -X POST http://localhost:3001/v1/admin/reindex \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"fromBlock": 1000000}'
```

### 3.2 Full Reindex

```bash
# 1. Stop the API server
kubectl scale deployment/cruzible-api --replicas=0 -n cruzible

# 2. Truncate indexed data (preserves schema)
psql $DATABASE_URL -c "TRUNCATE blocks, transactions, events CASCADE;"

# 3. Restart — IndexerService will backfill from genesis (or configured start block)
kubectl scale deployment/cruzible-api --replicas=1 -n cruzible

# 4. Monitor progress
watch -n 5 'curl -s http://localhost:3001/health/ready | jq ".checks.indexer"'
```

---

## 4. Incident Response

### 4.1 Severity Classification

| Level | Definition | Response Time | On-Call |
|-------|-----------|---------------|---------|
| SEV-0 | Active fund theft or protocol compromise | Immediate | Entire team |
| SEV-1 | Potential exploit, no active theft | < 1 hour | Security team |
| SEV-2 | Data inconsistency, non-critical bug | < 24 hours | Engineering |
| SEV-3 | Minor issue, no user impact | Next sprint | Standard workflow |

### 4.2 SEV-0 / SEV-1 Response Procedure

1. **Detect**: Alert fired via reconciliation scheduler, monitoring, or user report
2. **Triage**: Confirm the issue (check on-chain state, indexer, logs)
3. **Contain**: Pause the vault immediately:
   ```bash
   aethelredd tx wasm execute <VAULT_ADDR> '{"pause":{}}' --from admin
   ```
4. **Communicate**: Post to #incident-response (Discord/Slack) within 15 minutes
5. **Investigate**: Review audit logs, transaction history, reconciliation data
6. **Fix**: Deploy contract upgrade (via timelock) or keeper governance proposal
7. **Verify**: Run full test suite + reconciliation on the fix
8. **Resume**: Unpause after fix is verified:
   ```bash
   aethelredd tx wasm execute <VAULT_ADDR> '{"unpause":{}}' --from admin
   ```
9. **Report**: Publish post-mortem within 72 hours

### 4.3 Communication Template

```
[SEV-X] Cruzible Incident — [Brief Description]

Status: [Investigating | Mitigating | Resolved]
Impact: [User-facing impact description]
Start time: [UTC timestamp]
Current actions: [What the team is doing]
ETA: [Estimated resolution time]

Updates will be posted every [15min | 1hr] until resolved.
```

---

## 5. Attestation Relay Management

### 5.1 Relay Revocation (Emergency)

When the attestation relay key is suspected compromised:

```bash
# 1. Revoke the relay (zeroes vendorRootKey, blocks new registrations)
cast send <VAULT_TEE_VERIFIER> "revokeRelay()" --from $GOVERNANCE_MULTISIG

# 2. Verify revocation
cast call <VAULT_TEE_VERIFIER> "attestationRelay()" | jq

# 3. Register a new relay with a fresh key pair
cast send <VAULT_TEE_VERIFIER> \
  "registerAttestationRelay(bytes32,bytes32)" \
  $NEW_RELAY_PUB_X $NEW_RELAY_PUB_Y \
  --from $GOVERNANCE_MULTISIG
```

### 5.2 Relay Key Rotation (Planned)

```bash
# 1. Initiate rotation (starts 48h timelock)
cast send <VAULT_TEE_VERIFIER> \
  "initiateRelayRotation(bytes32,bytes32)" \
  $NEW_PUB_X $NEW_PUB_Y \
  --from $GOVERNANCE_MULTISIG

# 2. Wait 48 hours

# 3. Finalize rotation
cast send <VAULT_TEE_VERIFIER> "finalizeRelayRotation()" --from $GOVERNANCE_MULTISIG
```

### 5.3 Relay Liveness Challenge

If the relay appears unresponsive:

```bash
# Issue a challenge (relay has 1 hour to respond)
cast send <VAULT_TEE_VERIFIER> "challengeRelay()" --from $ANY_ADDRESS

# Check if the relay responded
cast call <VAULT_TEE_VERIFIER> "attestationRelay()" | jq '.lastChallengeTime'
```

---

## 6. Vault Pause / Unpause

### 6.1 Emergency Pause

```bash
# Pause — blocks all mutating operations (stake, unstake, withdraw, claim)
aethelredd tx wasm execute <VAULT_ADDR> '{"pause":{}}' --from admin

# Verify pause state
aethelredd query wasm contract-state smart <VAULT_ADDR> '{"is_paused":{}}'
```

### 6.2 Unpause (After Investigation)

```bash
# Unpause — only after the triggering condition is resolved
aethelredd tx wasm execute <VAULT_ADDR> '{"unpause":{}}' --from admin

# Verify operations are functioning
curl http://localhost:3001/health/ready | jq
```

### 6.3 Circuit Breaker Auto-Pause

The vault automatically pauses when:
- Unstake volume exceeds `MaxUnstakePerEpochPct` of TVL in a single epoch
- Slash count exceeds `MaxSlashesPerEpoch` in a single epoch

**Recovery**: Investigate the triggering condition, then `unpause` via governance.

---

## 7. Reconciliation Scheduler

### 7.1 Monitoring

```bash
# Check scheduler status via health endpoint
curl http://localhost:3001/health/ready | jq '.checks.reconciliation'

# Expected response when healthy:
# {
#   "status": "OK",
#   "activeCriticalAlerts": 0,
#   "ready": true
# }
```

### 7.2 Scheduler Not Running

If the reconciliation check shows no results:

1. Check API logs for scheduler startup errors:
   ```bash
   kubectl logs deployment/cruzible-api -n cruzible | grep -i reconciliation
   ```
2. Verify the `ReconciliationScheduler.start()` call in the startup sequence
3. Check for PrismaClient connection errors (database connectivity)
4. Restart the API pod if necessary:
   ```bash
   kubectl rollout restart deployment/cruzible-api -n cruzible
   ```

### 7.3 Persistent CRITICAL Status

If reconciliation reports CRITICAL:

1. Check which specific check is failing:
   ```bash
   curl http://localhost:3001/v1/reconciliation/latest | jq '.checks[] | select(.status != "PASS")'
   ```
2. Common causes:
   - **Exchange rate drift > 5%**: Check for vault exploit, verify on-chain state
   - **Validator count below minimum**: Check for mass jailing event
   - **TVL mismatch**: Indexer may be behind — check indexer lag
3. If the issue is a false positive (e.g., indexer lag), resolve the root cause
4. If the issue is real, escalate to SEV-1 incident response

---

## 8. Monitoring Dashboards

| Dashboard | URL | Purpose |
|-----------|-----|---------|
| API Health | `/health/ready` | Readiness check with all subsystem statuses |
| Reconciliation | `/v1/reconciliation/latest` | Latest reconciliation result |
| Alerts | `/v1/alerts` | Active and historical alerts |
| Indexer Metrics | `/health/ready` → `checks.indexer` | Block lag and sync status |

---

## 9. Useful Commands

```bash
# Check all service health
curl -s http://localhost:3001/health/ready | jq

# Get current vault state from chain
aethelredd query wasm contract-state smart <VAULT_ADDR> '{"vault_state":{}}'

# List active validators
aethelredd query staking validators --status bonded -o json | jq '.validators | length'

# Check governance proposals
aethelredd query wasm contract-state smart <GOV_ADDR> '{"proposals":{"limit":10}}'

# Run contract tests locally
cd backend/contracts && ./cargo-isolated.sh test --all

# Run backend API tests
cd backend/api && npx vitest run
```

---

## 10. Stablecoin Bridge Operations

### 10.1 Circuit Breaker Reset

When a circuit breaker trips (detected by `CircuitBreakerTriggered` event or reconciliation alert):

```bash
# 1. Check which assets have tripped circuit breakers
curl http://localhost:3001/v1/stablecoins | jq '.data[] | select(.circuitBreakerTripped == true)'

# 2. Investigate the triggering event
curl "http://localhost:3001/v1/stablecoins/<ASSET_ID>/history?event_type=CircuitBreakerTriggered&limit=5"

# 3. Review the reason code and observed vs threshold values
# The metadata field contains: { reasonCode, observed, threshold }

# 4. After investigation, reset the circuit breaker on-chain
# (admin-only, requires the bridge admin key)
# cast send <BRIDGE_ADDR> "resetCircuitBreaker(bytes32)" <ASSET_ID> --private-key <ADMIN_KEY>

# 5. Verify the circuit breaker is cleared
curl "http://localhost:3001/v1/stablecoins/<ASSET_ID>/status" | jq '.data.circuitBreakerTripped'
```

### 10.2 Daily Limit Monitoring

The reconciliation scheduler alerts at 80% daily usage. Monitor via:

```bash
# Check all stablecoin statuses
curl http://localhost:3001/v1/stablecoins | jq '.data[] | {symbol, dailyUsed, dailyLimit, active}'

# Check specific asset status with usage percentage
curl "http://localhost:3001/v1/stablecoins/<ASSET_ID>/status" | jq '.data'
# Expected: { dailyUsagePercent: <number>, dailyLimit: "...", dailyUsed: "..." }

# Daily usage resets automatically when the indexer processes a new-day event.
# If the counter appears stuck, verify the indexer is running:
curl http://localhost:3001/health/ready | jq '.checks.indexer'
```

### 10.3 Bridge Pause Procedure

To temporarily disable a specific stablecoin's bridge operations:

```bash
# 1. Pause mint operations on-chain (admin-only)
# cast send <BRIDGE_ADDR> "setMintPaused(bytes32,bool)" <ASSET_ID> true --private-key <ADMIN_KEY>

# 2. Verify the frontend shows the asset as paused
# The UI reads on-chain config and disables the bridge form when mintPaused=true

# 3. To fully disable the asset:
# cast send <BRIDGE_ADDR> "setEnabled(bytes32,bool)" <ASSET_ID> false --private-key <ADMIN_KEY>

# 4. Re-enable after investigation:
# cast send <BRIDGE_ADDR> "setEnabled(bytes32,bool)" <ASSET_ID> true --private-key <ADMIN_KEY>
# cast send <BRIDGE_ADDR> "setMintPaused(bytes32,bool)" <ASSET_ID> false --private-key <ADMIN_KEY>
```

### 10.4 Adding a New Stablecoin

To add a new stablecoin (e.g., USDU) to the bridge:

1. **On-chain**: Call `configureStablecoin()` with the new asset's parameters
2. **Frontend**: Add entry to `STABLECOIN_ASSETS` in `src/lib/constants.ts` with appropriate phase
3. **Backend**: Add the token address env var to `CONTRACT_ADDRESSES` in `config/chains.ts`
4. **Indexer**: No changes needed — the IndexerService automatically indexes all bridge contract events
5. **Environment**: Set the new env vars: `NEXT_PUBLIC_<SYMBOL>_TOKEN_ADDRESS`

### 10.5 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS` | Bridge contract proxy address | `0x...` |
| `NEXT_PUBLIC_USDC_TOKEN_ADDRESS` | USDC ERC-20 token on Aethelred | `0x...` |
| `NEXT_PUBLIC_USDT_TOKEN_ADDRESS` | USDT ERC-20 token on Aethelred | `0x...` |
| `STABLECOIN_BRIDGE_ADDRESS` | Bridge address for indexer (backend) | `0x...` |
