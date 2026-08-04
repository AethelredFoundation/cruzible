# Cruzible Public-Testnet Acceptance Checklist

This checklist starts only after the operator completes
[TESTNET_DEPLOYMENT.md](TESTNET_DEPLOYMENT.md). That runbook is the sole source
for source pinning, contract deployment, environment variables, API/indexer
setup, frontend build, port assignments, precompile checks, and rollback.

Do not substitute a branch name, an old contract address, or a previous
frontend build. Record the approved commit and candidate deployment manifest
before testing.

## 1. Entry criteria

Require all of the following:

- immutable approved commit checked out with a clean tracked worktree;
- candidate manifest source SHA equals that commit;
- live chain ID `7332` and the expected EVM block-1 anchor;
- new matched Cruzible and StAETHEL addresses from the candidate manifest;
- release deployment validation passed against live runtime bytecode;
- frontend served on port `3000` and API served on port `4001`;
- read-only `stakeWithMinShares` simulation passed;
- test wallet funded with more than `1 AETHEL`;
- ZeroID and Digital Seal admission gates disabled for the base lifecycle.

The parameter proposal for `0x0800` and `0x0801` is a separate chain-state
change. It does not require a chain reset or a software-upgrade handler and
does not block the base stake lifecycle.

## 2. Network and service checks

1. Confirm the frontend `/vault` page loads without broken styling.
2. Confirm the header block height advances.
3. Confirm the browser uses the operator-approved EVM RPC and chain `7332`.
4. Confirm `/health/live` succeeds.
5. Confirm `/health/ready` reports the expected candidate contract identity.
6. If the indexer is enabled, confirm its WebSocket connection stays healthy,
   its cursor starts at the candidate deployment block, and reconciliation
   becomes fresh.
7. If the indexer is intentionally disabled, confirm reconciliation is shown
   as unavailable rather than fabricated or stale.

Stop on chain-ID, genesis-anchor, contract-address, CORS, CSP, API, or indexer
identity mismatch.

## 3. Wallet connection

Test Aethelred Wallet and MetaMask separately:

1. configure the operator-approved RPC, chain ID `7332`, and currency
   `AETHEL`;
2. connect through the injected wallet path;
3. confirm the displayed account matches the extension;
4. confirm native AETHEL and any existing stAETHEL balances come from the
   candidate network;
5. disconnect and reconnect once to prove session recovery.

WalletConnect is outside this test unless a valid operator-owned project ID is
registered for the frontend origin. An unregistered ID can create periodic
relay `Project not found` failures and must not be compiled into the candidate.

## 4. One-small-stake gate

Use the same funded wallet supplied to the read-only simulation:

1. open Vault → Stake;
2. enter exactly `1 AETHEL`;
3. wait for a fresh exchange-rate quote;
4. submit once;
5. require a wallet confirmation prompt;
6. approve once;
7. require a successful receipt and `Staked` event;
8. verify native balance decreased by stake plus gas;
9. verify stAETHEL balance increased by the emitted share/accounting result.

If the UI says simulation failed before signing, stop. No wallet prompt is the
expected consequence of the fail-closed preflight. The likely causes are a
stale/incompatible vault, mismatched vault/token wiring, a live admission or
pause gate, insufficient test balance, a stale quote, or the wrong network.
It is not evidence that MetaMask itself failed.

Do not retry with a larger amount and do not bypass simulation.

## 5. Exit lifecycle

After the small stake succeeds:

1. request an unstake of a bounded portion of the new stAETHEL balance;
2. require a wallet prompt and successful `Unstaked` event;
3. verify the withdrawal entry includes the on-chain completion time;
4. verify the queued amount is reserved and no longer rebases;
5. wait for the configured `3600`-second public-testnet window;
6. claim once;
7. require a successful `Withdrawn` event;
8. reconcile native AETHEL and stAETHEL balances, allowing only transaction
   gas as the unexplained difference.

Do not shorten the deployed unbonding period after the fact. A different
period requires a separate candidate deployment.

## 6. Validator-yield functions

Plain stake and exit tests do not call the staking or distribution precompiles.
Test validator delegation, undelegation, reconciliation, and earned rewards
only after:

- the governance proposal is `PROPOSAL_STATUS_PASSED`;
- the active set contains exactly `0x0800`, `0x0801`, `0x0900`, `0x0901`, and
  `0x0902`;
- all validators report matching application state at the same height;
- the governance signer, validator target, amount, concentration cap, and
  minimum-buffer policy have separate approval.

A revert from a validator-yield function before those checks is not a failure
of the base stake lifecycle.

## 7. Optional admission-gate tests

Run these only as separate approved tests after the base lifecycle passes:

- ZeroID: enable the identity gate against the approved registry, prove an
  unregistered or inactive wallet is rejected, then prove an active identity
  is accepted.
- Digital Seal: configure the approved policy and completed, wallet-bound
  seal evidence, prove plain admission is rejected when required, then prove
  the bounded seal entrypoint succeeds.

Exits must remain available even when a wallet later fails an admission check.

## 8. Browser and operational observations

Treat these as failures:

- CSP upgrades the temporary HTTP origin to HTTPS and breaks assets;
- API origin is absent from `connect-src`;
- repeated WalletConnect code `3000` while no valid project is in scope;
- contract simulation reports an unknown revert;
- candidate frontend displays retired contract data;
- indexer reuses a cursor bound to another vault;
- a transaction is submitted more than once;
- UI reports success before a successful receipt.

Record any slow injected-wallet discovery or reconnect time separately from
contract execution latency.

## 9. Acceptance evidence

Return:

- frontend and API origins;
- approved source SHA and candidate manifest identifier;
- non-secret build environment;
- wallet type and test address;
- read-only simulation result;
- stake, unstake, and claim transaction hashes and blocks;
- emitted event values and before/after balances;
- API readiness and indexer status;
- precompile proposal/status evidence for any validator-yield test;
- browser console errors and relevant server logs;
- pass/fail decision and any rollback performed.
