# Cruzible Testnet Testing Guide

For the testnet operations team. Covers building the frontend against a
self-hosted node (pre-DNS, pre-TLS), the end-to-end flows to exercise, what is
intentionally unavailable, and what to report back. Assumes the backend stack
is already up via `docker compose up --build -d` (see `.env.testnet.example`).

## 1. Build & serve the frontend (pre-DNS/pre-TLS profile)

Three env vars beyond the addresses matter here:

- `NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL` — **your node's public EVM RPC.**
  Without it the bundle falls back to the placeholder DNS
  (`evm-rpc-testnet.aethelred.network`, which does not resolve) and every
  chain card shows "Unavailable". Compiled in at **build time**.
- `CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true` — omits HSTS and the CSP
  `upgrade-insecure-requests` directive. Without it, a page served over plain
  HTTP on a public IP has every asset request auto-upgraded to https →
  `ERR_SSL_PROTOCOL_ERROR` and an unstyled page. Set it at **build and start**
  (headers are applied at runtime). Remove it the day real TLS exists.
- `CRUZIBLE_EXTRA_API_ORIGINS` — same value as at validate time; the CSP
  middleware admits it into `connect-src` so the browser may call your API.

Topology note: `<node-host>` is the chain-node server (ports 26657/8545) and
`<dapp-host>` is the machine running the compose backend (:4001) and this
frontend (:3000) — often the same machine for the frontend and API, and a
different one for the node. The compose backend serves plain **http**; under
the plaintext profile the build gate accepts an `http://` API origin, so no
TLS or certificate step is needed for testing.

```bash
git pull   # branch ramesh/production-grade-hardening

export CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true
export CRUZIBLE_EXTRA_API_ORIGINS=http://<dapp-host>:4001
NEXT_PUBLIC_CHAIN_ENV=testnet \
NEXT_PUBLIC_API_URL=http://<dapp-host>:4001/v1 \
NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL=http://<node-host>:8545 \
NEXT_PUBLIC_CRUZIBLE_ADDRESS=0x<vault> \
NEXT_PUBLIC_STAETHEL_ADDRESS=0x<staethel> \
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<real 32-hex id> \
npm run build

npm run standalone:prepare
node .next/standalone/server.js   # with the two exports still set
```

> **The `export`ed pair is read at RUNTIME, not baked at build.** The
> `NEXT_PUBLIC_*` values are compiled into the bundle, but
> `CRUZIBLE_ALLOW_PLAINTEXT_HTTP` and `CRUZIBLE_EXTRA_API_ORIGINS` are
> evaluated by the CSP middleware on every request. If they are absent from
> the environment of `node .next/standalone/server.js`, the served CSP still
> contains `upgrade-insecure-requests` (https upgrade, broken assets) and
> omits your API origin from `connect-src` (blocked API calls) — **without
> any rebuild being needed to fix it**: just restart the server with both
> variables set. Verify from any machine:
> `curl -sI http://<frontend-host>:3000/ | grep -i content-security` — the
> policy must NOT contain `upgrade-insecure-requests` and MUST list your API
> origin in `connect-src`.

## 2. Prerequisites outside this repo

- **Node RPC reachable from testers' browsers.** The frontend's chain reads
  come from the browser, not the server — the EVM JSON-RPC (:8545) must be
  publicly reachable and must allow cross-origin requests from the frontend
  origin (enable CORS on the node's JSON-RPC config for testing).
- **API certificate — only if you serve the API over https.** The compose
  backend is plain http, so under the plaintext profile there is no
  certificate step. If you later front the API with a self-signed https
  proxy, each tester's browser must trust it once — open
  `https://<dapp-host>:4001/health/live`, accept the warning, confirm
  `{"ok":true}`; until then API calls fail silently in the app.
- **WalletConnect project ID.** Use a real ID from cloud.walletconnect.com and
  add your frontend origin to its allowed domains — otherwise the console
  shows a 403 from `api.web3modal.org` (harmless for injected-wallet testing,
  blocks WalletConnect QR flows).

## 3. End-to-end frontend flow

Run through these in order; each step gates the next.

1. **Explorer landing** — the header block pill and the "Latest Block" /
   "Protocol Epoch" cards populate with live numbers (they read the RPC
   directly). If they say "Unavailable", stop: the RPC URL/CORS is wrong.
2. **Connect a wallet** — Aethelred Wallet extension (point its network RPC at
   your node) or any injected wallet with a custom network: chain id **7332**,
   currency AETHEL, RPC as above. Fund the account (faucet or a genesis
   account).
3. **Stake (native AETHEL)** — Vault page → stake an amount → confirm in the
   wallet. Expect: AETHEL balance drops, **stAETHEL** balance appears,
   exchange rate reads 1.0 on a fresh vault. Compliance/seal gating is OFF by
   default (`complianceRequired=false`), so plain staking works before the
   ISeal precompile is live.
4. **Request unstake** — creates a withdrawal-queue entry; your deployment
   used a **3600 s unbonding period**. The queued amount is reserved at
   request time (it no longer rebases).
5. **Claim** — after the window elapses, claim the queued withdrawal; native
   AETHEL returns. Verify balances reconcile to within gas.
6. **Reconciliation page** — populates once the backend indexer has processed
   vault events (compose `--profile indexer`, node WS on :8546 — or accept
   this stays pending with `INDEXER_ENABLED=false`). Backend
   `/health/ready` mirrors the same state.
7. **Validators page** — backend/API-fed; verify against
   `aethelredd query staking validators` output.
8. **Automated readiness sweeps** (optional, from a dev machine):
   `PLAYWRIGHT_BASE_URL=http://<frontend-host>:3000 npx playwright test e2e/`
   — public-readiness, accessibility, mobile, and performance-budget specs.

## 4. Intentionally unavailable on testnet (do not file as bugs)

- **Stablecoins / bridge, governance** — no contracts exist for them yet; the
  UI feature-gates on their blank addresses.
- **Seal-gated compliance staking** — until the ISeal precompile (0x0900) is
  live on the chain build and governance flips `complianceRequired`.
- **Historical explorer feeds / seeded charts** — gated until indexed
  provenance is audit-grade (stated on the landing page).
- **Reconciliation freshness** — CRITICAL until the indexer has data; this is
  the truth-first posture, not a fault.

## 5. Known console noise (non-blockers)

- WalletConnect `metadata.url` mismatch warning (metadata says
  `vault.aethelred.org`) — cosmetic until real hosting.
- `api.web3modal.org` 403 — see WalletConnect project ID note above.
- COOP "origin untrustworthy" warning — inherent to plain-HTTP hosting;
  disappears with TLS.

## 6. Report back

Frontend origin + build env used, the tx hashes of one full
stake → request-unstake → claim cycle, `/health/ready` JSON after the indexer
has run, any RPC/CORS configuration you had to apply to the node, and console
errors not listed in §5.
