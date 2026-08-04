# Cruzible Public-Testnet Fresh Deployment Runbook

This is the canonical operator procedure for deploying the current Cruzible
EVM contracts, API/indexer, and frontend to the Aethelred public testnet. The
testing checklist in [TESTNET_TESTING_GUIDE.md](TESTNET_TESTING_GUIDE.md) does
not define a second setup path.

The procedure is a dApp replacement deployment. It does **not** reset the
chain, change genesis, restart the public testnet from scratch, or require a
software-upgrade handler.

## 1. Release decision

The current frontend sends native AETHEL through
`stakeWithMinShares(uint256)` (selector `0x9975ae71`). It first simulates that
exact call and invokes the wallet only after simulation succeeds. The prior
public-testnet vault supports the older `stake()` selector `0x3a4b66f1` but
predates the bounded stake/unstake interface and the current share-accounting
behavior. Pointing this frontend at that vault therefore produces an
undecodable simulation revert before the wallet can show a confirmation.

This is not a wallet-connection fault. It is also not caused by the staking
and distribution precompiles:

- plain stake, request-unstake, and claim use only the Cruzible and stAETHEL
  contracts;
- `0x0800` and `0x0801` are used only by validator delegation, undelegation,
  reconciliation, and earned-reward functions.

Deploy a new matched Cruzible + StAETHEL pair from the approved source commit.
The contracts are not proxies, so there is no in-place contract upgrade.
Deploy WstAETHEL in the same ceremony unless the release owner explicitly
removes it from scope.

## 2. Required operator inputs

Record these in the change ticket before starting. Never put private keys,
tokens, or database credentials in Git, chat, screenshots, or the deployment
manifest.

| Variable                  | Required value                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| `APPROVED_COMMIT_SHA`     | Release-owner-approved 40-character Cruzible commit               |
| `EVM_RPC_URL`             | Operator-approved EVM JSON-RPC endpoint                           |
| `EVM_WS_URL`              | Matching EVM WebSocket endpoint if the indexer is enabled         |
| `COMET_RPC_URL`           | Matching CometBFT RPC endpoint                                    |
| `EXPECTED_GENESIS_HASH`   | Public-testnet EVM block-1 hash                                   |
| `DAPP_ORIGIN`             | Browser origin for the frontend, including scheme and port 3000   |
| `API_ORIGIN`              | Browser-reachable API origin, normally the same host on port 4001 |
| `DEPLOYER_KEY`            | Funded EVM deployer key, supplied from the approved secret system |
| `GOVERNANCE`              | EVM governance owner or testnet governance signer                 |
| `REWARDER`                | EVM reward operator                                               |
| `PAUSER`                  | EVM emergency pause operator                                      |
| `TEST_STAKER_ADDRESS`     | Funded EVM test wallet with more than 1 AETHEL                    |
| `PRECOMPILE_PROPOSAL_ID`  | Governance proposal that adds `0x0800` and `0x0801`               |
| `AUTH_OPERATOR_ADDRESSES` | Approved API operator wallet addresses                            |
| `AUTH_ADMIN_ADDRESSES`    | Approved API administrator wallet addresses                       |

The confirmed public-testnet EIP-155 chain ID is `7332`. The confirmed
canonical EVM block-1 anchor used by the current public testnet is:

```text
0xf4b43647f4d3255a7e9321ea4b32057101ed143623390bc30d59e69a91ceafa7
```

Verify it independently from the operator-approved RPC; do not trust a copied
value without the check in section 4.

For the initial plain-stake gate, leave both the ZeroID identity gate and the
Digital Seal admission gate disabled. A later, separately approved integration
test may enable them after the base stake lifecycle passes.

## 3. Pin and verify the source

Use an immutable commit, not a moving branch name:

```bash
git fetch --prune origin
git switch --detach "$APPROVED_COMMIT_SHA"
test "$(git rev-parse HEAD)" = "$APPROVED_COMMIT_SHA"
test -z "$(git status --porcelain --untracked-files=no)"

node --version
npm --version
npm ci
npm run contracts:evm:check
npm run type-check
```

Stop if the commit differs, the tracked worktree is dirty, dependency
installation changes the lockfile, Solidity artifacts drift from source, or a
contract test fails.

## 4. Verify chain identity and the parameter proposal

First verify the EVM identity:

```bash
curl -sS -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  "$EVM_RPC_URL"

curl -sS -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0x1",false]}' \
  "$EVM_RPC_URL"
```

The responses must contain chain ID `0x1ca4` and block number `0x1` with
`EXPECTED_GENESIS_HASH`. Stop on any mismatch.

The active-precompile change is an on-chain EVM parameter proposal. It is not a
binary software-upgrade proposal, does not use an upgrade handler, and does not
require a chain reset. Inspect it and its tally:

```bash
aethelredd query gov proposal "$PRECOMPILE_PROPOSAL_ID" \
  --node "$COMET_RPC_URL" --output json

aethelredd query gov tally "$PRECOMPILE_PROPOSAL_ID" \
  --node "$COMET_RPC_URL" --output json

aethelredd query evm params \
  --node "$COMET_RPC_URL" --output json
```

Before execution, `0x0900`, `0x0901`, and `0x0902` must remain active. After
the voting period closes, require proposal status
`PROPOSAL_STATUS_PASSED`, then run:

```bash
aethelredd query evm params \
  --node "$COMET_RPC_URL" --output json |
python3 -c 'import json,sys
p=set(json.load(sys.stdin)["params"]["active_static_precompiles"])
expected={
"0x0000000000000000000000000000000000000800",
"0x0000000000000000000000000000000000000801",
"0x0000000000000000000000000000000000000900",
"0x0000000000000000000000000000000000000901",
"0x0000000000000000000000000000000000000902",
}
assert p == expected, (p, expected)
print("active precompile set verified")'
```

Query the same height from every validator RPC and confirm matching app hashes
and healthy consensus logs before enabling delegation or reward operations.
The contract deployment and plain-stake test may be prepared while voting is
open, but no Cruzible validator operation may use `0x0800` or `0x0801` until
the post-pass checks succeed.

## 5. Deploy the replacement contracts

The deployer must hold enough native AETHEL for three contract creations and
configuration transactions. Supply the private key through the approved
secret mechanism; if an interactive shell is the approved mechanism, avoid
placing it in shell history:

```bash
read -r -s -p "Deployer private key: " DEPLOYER_KEY
export DEPLOYER_KEY
```

Set the release inputs explicitly:

```bash
: "${EVM_RPC_URL:?set EVM_RPC_URL}"
: "${APPROVED_COMMIT_SHA:?set APPROVED_COMMIT_SHA}"
: "${GOVERNANCE:?set GOVERNANCE}"
: "${REWARDER:?set REWARDER}"
: "${PAUSER:?set PAUSER}"

export RPC_URL="$EVM_RPC_URL"
export DEPLOYMENT_ENV=testnet
export RELEASE_DEPLOYMENT=1
export UNBONDING_PERIOD_SECONDS=3600
export GOVERNANCE
export REWARDER
export PAUSER
export OUT=".release-evidence/cruzible-testnet-${APPROVED_COMMIT_SHA}.json"

unset ZEROID_REGISTRY
unset SKIP_WSTAETHEL

node scripts/deploy-contracts.mjs
unset DEPLOYER_KEY
```

The script performs, in order:

1. chain-ID, balance, block-1, clean-source, Forge-build, and artifact checks;
2. Cruzible vault deployment;
3. StAETHEL deployment and one-time two-way wiring;
4. WstAETHEL deployment;
5. exchange-rate, unbonding-period, bytecode, role, transaction, and manifest
   evidence capture;
6. optional two-step governance nomination.

It does not deploy the earlier CosmWasm contracts in `backend/contracts`.

Extract and validate the non-secret evidence:

```bash
export DEPLOYMENT_MANIFEST="$OUT"
export CRUZIBLE_ADDRESS="$(jq -r '.contracts.Cruzible.address' "$DEPLOYMENT_MANIFEST")"
export STAETHEL_ADDRESS="$(jq -r '.contracts.StAETHEL.address' "$DEPLOYMENT_MANIFEST")"
export WSTAETHEL_ADDRESS="$(jq -r '.contracts.WstAETHEL.address' "$DEPLOYMENT_MANIFEST")"
export DEPLOYMENT_BLOCK="$(jq -r '.contracts.Cruzible.blockNumber' "$DEPLOYMENT_MANIFEST")"

jq -e --arg sha "$APPROVED_COMMIT_SHA" \
  '.source.gitCommit == $sha and .source.clean == true' \
  "$DEPLOYMENT_MANIFEST"

npm run deployment:evm:validate -- "$DEPLOYMENT_MANIFEST"
```

If `GOVERNANCE` differs from the deployer, the manifest will show a pending
two-step transfer. The nominated governance owner must submit
`acceptGovernance()` through its approved signing process and archive that
transaction hash. Do not assume nomination transferred control:

```bash
cast call "$CRUZIBLE_ADDRESS" 'pendingGovernance()(address)' \
  --rpc-url "$EVM_RPC_URL"

# Submit this target and calldata through the approved governance signer:
cast calldata 'acceptGovernance()'

cast call "$CRUZIBLE_ADDRESS" 'governance()(address)' \
  --rpc-url "$EVM_RPC_URL"
```

Rewarder and pauser roles are constructor values and have no acceptance
transaction.

## 6. Run the API and indexer from fresh state

Use a new Compose project name. This creates a fresh PostgreSQL volume and
prevents the candidate indexer from reusing a cursor bound to the retired
vault. Do not delete the previous project or its volume during validation.

```bash
cp .env.testnet.example .env
chmod 600 .env
export CRUZIBLE_COMPOSE_PROJECT="cruzible-testnet-candidate"
```

Populate `.env` with these values:

```dotenv
NODE_ENV=development
CRUZIBLE_API_PORT=4001

RPC_URL=<COMET_RPC_URL>
INDEXER_RPC_URL=<EVM_RPC_URL>
INDEXER_WS_URL=<EVM_WS_URL>
INDEXER_EXPECTED_CHAIN_ID=7332
INDEXER_EXPECTED_GENESIS_HASH=0xf4b43647f4d3255a7e9321ea4b32057101ed143623390bc30d59e69a91ceafa7
INDEXER_START_BLOCK=<DEPLOYMENT_BLOCK>

CRUZIBLE_VAULT_ADDRESS=<CRUZIBLE_ADDRESS>
STAETHEL_ADDRESS=<STAETHEL_ADDRESS>

CORS_ORIGINS=<DAPP_ORIGIN>
ALLOW_UNAUTHENTICATED_OPERATIONAL_ENDPOINTS=false
OPERATIONAL_ENDPOINTS_TOKEN=<independent-32+-character-secret>
JWT_SECRET=<independent-32+-character-secret>
JWT_REFRESH_SECRET=<independent-32+-character-secret>
LOG_HASH_SECRET=<independent-32+-character-secret>
AUTH_OPERATOR_ADDRESSES=<approved-operator-wallets>
AUTH_ADMIN_ADDRESSES=<approved-admin-wallets>
```

Generate each secret independently and inject it without logging it. Do not use
the example names, repeated values, or development defaults.

Do not put `INDEXER_ENABLED` in `.env`. The root Compose manifest forces it to
`false` in the API process and `true` in the one dedicated indexer process.
That is the only supported topology for this single-box profile. If WebSocket
JSON-RPC is unavailable, omit `INDEXER_WS_URL`; the worker will use bounded
HTTP polling through `INDEXER_RPC_URL` and may take longer to catch up.

Validate and start the candidate:

```bash
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" config --quiet
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" up --build -d
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" ps
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" logs \
  --tail 200 api indexer

curl -fsS "$API_ORIGIN/health/live"
curl -sS -w '\nHTTP %{http_code}\n' "$API_ORIGIN/health/ready"
```

`/health/live` must return HTTP 200. `/health/ready` may return HTTP 503 while
the dedicated indexer rebuilds projections or catches up; it must become 200
before the candidate is promoted.

The root Compose stack is the single-box public-testnet bring-up profile. It
uses local PostgreSQL and Redis and is not the production infrastructure
profile described in `docs/ops/runbook.md`.

### Recover an existing stuck rebuild without resetting data

A response with healthy database/RPC checks, `requiresRebuild: true`, and a
large positive indexer lag means the durable indexer has not completed its
automatic projection rebuild. It is not evidence that the chain or contracts
need to be reset or redeployed. Resolve the exact Compose project that owns the
API before operating on it:

```bash
docker ps --filter label=com.docker.compose.service=api \
  --format 'project={{.Label "com.docker.compose.project"}} container={{.Names}} ports={{.Ports}}'
docker ps --filter label=com.docker.compose.service=indexer \
  --format 'project={{.Label "com.docker.compose.project"}} container={{.Names}} status={{.Status}}'

export CRUZIBLE_COMPOSE_PROJECT="replace-with-exact-project-from-the-api-row"
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" config --quiet
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" ps -a
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" exec -T api \
  sh -c 'printf "API INDEXER_ENABLED=%s\n" "${INDEXER_ENABLED:-unset}"'

docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" exec -T postgres \
  psql -U cruzible -d cruzible -c \
  'SELECT "cursorKey","blockNumber","requiresRebuild","recoveryTargetBlock","pendingBlockNumber","networkChainId","networkVaultAddress","networkStaethelAddress","updatedAt" FROM "IndexerCursor";'
```

On an older deployment where the API reports `INDEXER_ENABLED=true`, first
stop any separate worker, recreate only the API from this manifest, verify the
API-side indexer is disabled, and then start exactly one dedicated worker:

```bash
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" stop indexer
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" up --build -d --no-deps \
  --force-recreate api
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" exec -T api \
  sh -c 'test "$INDEXER_ENABLED" = false'
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" up --build -d --no-deps indexer
```

If the API already reports `INDEXER_ENABLED=false`, do not recreate it; start
the missing dedicated worker with only the final command above. Then monitor
the existing cursor and recovery marker:

```bash
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" ps indexer
docker compose -p "$CRUZIBLE_COMPOSE_PROJECT" logs --tail 200 indexer

curl -fsS "$API_ORIGIN/health/live"
curl -sS "$API_ORIGIN/health/ready" |
  jq '.checks | {indexer,reconciliation}'
curl -sS "$API_ORIGIN/v1/reconciliation/live?validator_limit=50" |
  jq '{epoch,warnings,discrepancies}'
```

Require the lag to decrease over successive checks. Recovery is complete when
`requiresRebuild` is `false`, `pendingBlockNumber` is `null`,
`networkIdentityValid` is `true`, `cursorAheadOfRpc` and `stale` are `false`,
and indexer `ready` is `true`. The `INDEXER_GENERATION_UNCOMMITTED`
discrepancy must disappear. A prior critical alert can remain active for up to
15 minutes after the next healthy reconciliation; require the protocol status
to be `OK` or `WARNING` and `activeCriticalAlerts` to be zero before promotion.

Never set `requiresRebuild` manually, edit or delete the cursor, run a Prisma
reset, remove the PostgreSQL volume, redeploy contracts, or restart the chain.
The worker owns the rebuild marker and clears it only after the materialized
state is internally consistent.

## 7. Bind and start the frontend on port 3000

The current shared public testnet uses these exact pre-TLS browser origins:

```bash
export DAPP_ORIGIN=http://93.127.132.52:3000
export API_ORIGIN=http://93.127.132.52:4001
export EVM_RPC_URL=http://54.165.44.130:8545
```

Build from the same immutable commit and candidate manifest:

```bash
export NEXT_PUBLIC_CHAIN_ENV=testnet
export NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL="$EVM_RPC_URL"
export NEXT_PUBLIC_AETHELRED_GENESIS_HASH="$EXPECTED_GENESIS_HASH"
export NEXT_PUBLIC_API_URL="$API_ORIGIN/v1"
export NEXT_PUBLIC_CRUZIBLE_ADDRESS="$CRUZIBLE_ADDRESS"
export NEXT_PUBLIC_STAETHEL_ADDRESS="$STAETHEL_ADDRESS"
export RELEASE_EVM_DEPLOYMENT_MANIFEST_JSON="$(jq -c . "$DEPLOYMENT_MANIFEST")"

unset NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS
unset NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

export CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true
export CRUZIBLE_EXTRA_API_ORIGINS="$API_ORIGIN"

npm run deployment:evm:release-validate
npm run build
npm run standalone:prepare

PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js
```

The release validator now requires the manifest source commit to equal the
checked-out commit, then verifies the deployment transactions, live runtime
bytecode, two-way vault/token wiring, chain ID, and block-1 anchor.

`CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true` is only for the documented pre-TLS public
testnet profile. Keep it and `CRUZIBLE_EXTRA_API_ORIGINS` in the frontend
process environment at runtime, not only during the build. Remove the plaintext
flag when trusted TLS is installed.

The frontend uses port `3000`; the API uses port `4001`. Confirm the served CSP:

```bash
curl -sSI "$DAPP_ORIGIN/vault" | rg -i content-security-policy
```

Under the temporary plaintext profile, the policy must include `API_ORIGIN`
and `http://54.165.44.130:8545` in `connect-src`, and it must not contain
`upgrade-insecure-requests`. For the current endpoints, the corresponding
backend-origin and frontend values are therefore:

```dotenv
CORS_ORIGINS=http://93.127.132.52:3000
NEXT_PUBLIC_CHAIN_ENV=testnet
NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL=http://54.165.44.130:8545
NEXT_PUBLIC_API_URL=http://93.127.132.52:4001/v1
CRUZIBLE_EXTRA_API_ORIGINS=http://93.127.132.52:4001
CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true
```

Aethelred Wallet and MetaMask use the injected EIP-6963 path and do not need a
WalletConnect project ID. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` only when
the operator owns a valid project registered for `DAPP_ORIGIN`; otherwise
leave it unset.

## 8. Read-only simulation and one-small-stake gate

Before asking a wallet to sign, run the repository's read-only candidate
simulation. It verifies chain identity, runtime code, two-way wiring, exchange
rate, unbonding period, pause/solvency/admission state, staker balance, and the
current `stakeWithMinShares` call. It never broadcasts:

```bash
RPC_URL="$EVM_RPC_URL" \
EXPECTED_GENESIS_HASH="$EXPECTED_GENESIS_HASH" \
EXPECTED_UNBONDING_PERIOD_SECONDS=3600 \
CRUZIBLE_ADDRESS="$CRUZIBLE_ADDRESS" \
STAETHEL_ADDRESS="$STAETHEL_ADDRESS" \
TEST_STAKER_ADDRESS="$TEST_STAKER_ADDRESS" \
npm run deployment:evm:simulate-stake
```

Stop if this command fails. Do not work around it by disabling simulation,
changing the frontend ABI, or pointing the candidate back to old addresses.

After the read-only gate passes:

1. open `DAPP_ORIGIN/vault` with the funded test wallet on chain `7332`;
2. verify a fresh live quote and the candidate addresses;
3. submit exactly `1 AETHEL`;
4. require the wallet confirmation to appear;
5. approve once and require a successful receipt plus a `Staked` event;
6. record the transaction hash, block, wallet, vault, amount, and resulting
   stAETHEL balance in the test evidence.

No higher-value stake, validator delegation, reward claim, or public promotion
is allowed until this gate passes.

## 9. Promotion and rollback

Treat the application commit, contract addresses, manifest, API/indexer state,
and frontend build as one release unit. Never run the new frontend against the
retired vault or the old frontend against the new vault.

Before promotion, retain the previous unit's commit, non-secret configuration,
contract addresses, image identifiers, and Compose project name in the change
ticket. If any candidate gate fails:

1. stop candidate traffic and the candidate frontend process;
2. stop the candidate Compose project without `-v`;
3. restore the previous complete application/address pair;
4. restart the previous Compose project and verify its health;
5. retain the candidate manifest and transaction evidence for investigation.

Contract creation transactions cannot be rolled back or deleted. A failed
candidate remains unused on-chain. Do not reset the chain, rewrite genesis,
delete database volumes, or submit a software-upgrade proposal as a rollback
mechanism.

## 10. Operator handoff evidence

Return all of the following:

- approved source SHA and clean-worktree proof;
- contract test and artifact-parity result;
- proposal status/tally and the post-pass five-address precompile check;
- deployment manifest and governance-acceptance transaction, if applicable;
- Cruzible, StAETHEL, and WstAETHEL addresses and deployment transactions;
- API/indexer Compose project and health output;
- frontend build inputs excluding secrets, origin, and CSP header;
- read-only simulation output;
- one-small-stake transaction and resulting balances;
- any rollback invoked and the complete release unit restored.
