#!/usr/bin/env node
/**
 * Cruzible Phase-2.5 — QUEUE↔UNDELEGATION WIRING, live devnet proof.
 *
 * Phase 2 made the vault EARN yield; Phase 2.5 closes the operational gap on
 * the way OUT: when queued withdrawals exceed the vault's native buffer,
 * ANYONE can trigger an undelegation sized exactly to the shortfall
 * (undelegateForQueue), the chain's real unbonding period runs, the funds
 * land back in the vault, and the queued exit is paid — no governance in the
 * loop. The slashing reconciler (reconcileValidator) is also exercised
 * against the REAL staking precompile queries (delegation +
 * unbondingDelegation decode), proving the accounting reads consensus truth.
 * (An actual slash needs a multi-validator net — a single-node devnet cannot
 * jail its only validator — so loss realization is proven in Foundry.)
 *
 * Requires a devnet whose staking unbonding_time is short (60s):
 *   genesis: .app_state.staking.params.unbonding_time = "60s"
 *
 * Env: RPC_URL (default http://127.0.0.1:8547), DEPLOYER_KEY (funded),
 *      KEEPER_KEY (funded with gas only — plays the permissionless caller),
 *      VALIDATOR (bech32 valoper of the devnet validator).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  formatEther,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(
  __dirname,
  "..",
  "backend",
  "contracts-evm",
  "artifacts",
);
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8547";
const VALIDATOR = process.env.VALIDATOR;
if (!VALIDATOR) {
  console.error("VALIDATOR required (bech32 valoper of the devnet validator)");
  process.exit(1);
}

const loadArtifact = (name) => ({
  abi: JSON.parse(readFileSync(join(artifactsDir, `${name}.abi`), "utf8")),
  bytecode: `0x${readFileSync(join(artifactsDir, `${name}.bin`), "utf8").trim()}`,
});

const chain = defineChain({
  id: 7332,
  name: "Aethelred Devnet",
  nativeCurrency: { name: "AETHEL", symbol: "AETHEL", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

for (const k of ["DEPLOYER_KEY", "KEEPER_KEY"]) {
  if (!process.env[k]) {
    console.error(`${k} required`);
    process.exit(1);
  }
}
const account = privateKeyToAccount(process.env.DEPLOYER_KEY);
const keeper = privateKeyToAccount(process.env.KEEPER_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});
const keeperClient = createWalletClient({
  account: keeper,
  chain,
  transport: http(RPC_URL),
});

const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};
const step = (m) => console.log(`\n== ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headroom = (est, floor) => (est * 2n > floor ? est * 2n : floor);

async function deploy(name, args) {
  const { abi, bytecode } = loadArtifact(name);
  const gas = headroom(
    await publicClient.estimateGas({
      account,
      data: encodeDeployData({ abi, bytecode, args }),
    }),
    6_000_000n,
  );
  const hash = await walletClient.deployContract({ abi, bytecode, args, gas });
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (r.status !== "success") fail(`${name} deploy reverted`);
  console.log(`${name} @ ${r.contractAddress}`);
  return { address: r.contractAddress, abi };
}

async function write(c, fn, args = [], value = 0n, client = walletClient) {
  const from = client === walletClient ? account : keeper;
  const gas = headroom(
    await publicClient.estimateContractGas({
      address: c.address,
      abi: c.abi,
      functionName: fn,
      args,
      value,
      account: from,
    }),
    800_000n,
  );
  const hash = await client.writeContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
    value,
    gas,
  });
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (r.status !== "success") fail(`${fn} reverted`);
  return r;
}

const read = (c, fn, args = []) =>
  publicClient.readContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
  });

// Direct staking-precompile surface: cross-check the vault's records against
// x/staking's own state at every step.
const STAKING_PRECOMPILE = {
  address: "0x0000000000000000000000000000000000000800",
  abi: [
    {
      name: "delegation",
      type: "function",
      stateMutability: "view",
      inputs: [
        { name: "delegatorAddress", type: "address" },
        { name: "validatorAddress", type: "string" },
      ],
      outputs: [
        { name: "shares", type: "uint256" },
        {
          name: "balance",
          type: "tuple",
          components: [
            { name: "denom", type: "string" },
            { name: "amount", type: "uint256" },
          ],
        },
      ],
    },
    {
      name: "unbondingDelegation",
      type: "function",
      stateMutability: "view",
      inputs: [
        { name: "delegatorAddress", type: "address" },
        { name: "validatorAddress", type: "string" },
      ],
      outputs: [
        {
          name: "unbondingDelegation",
          type: "tuple",
          components: [
            { name: "delegatorAddress", type: "string" },
            { name: "validatorAddress", type: "string" },
            {
              name: "entries",
              type: "tuple[]",
              components: [
                { name: "creationHeight", type: "int64" },
                { name: "completionTime", type: "int64" },
                { name: "initialBalance", type: "uint256" },
                { name: "balance", type: "uint256" },
                { name: "unbondingId", type: "uint64" },
                { name: "unbondingOnHoldRefCount", type: "int64" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

async function main() {
  step("chain identity");
  const chainId = await publicClient.getChainId();
  if (chainId !== 7332) fail(`chain id ${chainId}, want 7332`);
  console.log(`eth_chainId: ${chainId}  validator: ${VALIDATOR}`);

  step(
    "deploy + stake 20 AETHEL (vault queue delay 30s < chain unbonding 60s)",
  );
  const vault = await deploy("Cruzible", [
    account.address,
    account.address,
    account.address,
    30n,
  ]);
  const token = await deploy("StAETHEL", [vault.address]);
  await write(vault, "setStAethel", [token.address]);
  await write(vault, "stake", [], parseEther("20"));

  step("delegate 12 AETHEL — buffer drops to 8");
  await write(vault, "delegateToValidator", [VALIDATOR, parseEther("12")]);
  if ((await read(vault, "delegatedTo", [VALIDATOR])) !== parseEther("12"))
    fail("per-validator tracking");
  if ((await read(vault, "queueDeficit")) !== 0n)
    fail("no deficit while queue is empty");

  // The reconciler reads the REAL precompile delegation() — no loss expected,
  // the point is that the decode path runs against consensus state.
  await write(vault, "reconcileValidator", [VALIDATOR], 0n, keeperClient);
  if ((await read(vault, "delegatedTo", [VALIDATOR])) !== parseEther("12"))
    fail("reconcile against an unslashed validator must be a no-op");
  console.log(
    "reconcileValidator vs real delegation(): no-op on unslashed state ✓",
  );

  // ── 1. Queue an exit larger than the buffer ──────────────────────────────
  step("unstake 12 AETHEL — the 8-AETHEL buffer cannot cover it");
  await write(vault, "unstake", [parseEther("12")]);
  const deficit = await read(vault, "queueDeficit");
  if (deficit !== parseEther("4"))
    fail(`deficit ${formatEther(deficit)}, want 4`);
  const withdrawals = await read(vault, "getUserWithdrawals", [
    account.address,
  ]);
  const wid = withdrawals[withdrawals.length - 1].id;
  console.log(
    `withdrawal #${wid} queued for 12 AETHEL; queueDeficit = 4 AETHEL ✓`,
  );

  // ── 2. ANYONE covers the queue from the delegation ───────────────────────
  step("keeper (not governance) calls undelegateForQueue");
  await write(vault, "undelegateForQueue", [VALIDATOR], 0n, keeperClient);
  if ((await read(vault, "totalUnbonding")) !== parseEther("4"))
    fail("in-flight tracking");
  if ((await read(vault, "totalDelegated")) !== parseEther("8"))
    fail("bonded tracking");
  if ((await read(vault, "queueDeficit")) !== 0n)
    fail("in-flight unbonding must cover the queue");

  // x/staking's own unbonding record agrees with the vault's.
  const ubd = await publicClient.readContract({
    ...STAKING_PRECOMPILE,
    functionName: "unbondingDelegation",
    args: [vault.address, VALIDATOR],
  });
  if (
    ubd.entries.length !== 1 ||
    ubd.entries[0].balance !== parseEther("4") / 10n ** 12n
  )
    fail(`x/staking unbonding entries ${JSON.stringify(ubd.entries)}`);
  console.log(
    `permissionless undelegation of exactly the deficit ✓  x/staking entry: ${ubd.entries[0].balance} uaethel, completion ${new Date(Number(ubd.entries[0].completionTime) * 1000).toISOString()} ✓`,
  );

  // Reconcile with a live unbonding entry: exercises the vault's in-contract
  // unbondingDelegation() decode against the real precompile.
  await write(vault, "reconcileValidator", [VALIDATOR], 0n, keeperClient);
  if ((await read(vault, "totalUnbonding")) !== parseEther("4"))
    fail("reconcile with unslashed unbonding entry must be a no-op");
  console.log(
    "reconcileValidator vs real unbondingDelegation(): decode + no-op ✓",
  );

  // ── 3. The chain's unbonding period runs; funds return ───────────────────
  step("waiting ~75s for the chain's 60s unbonding period");
  const balBefore = await publicClient.getBalance({ address: vault.address });
  await sleep(75_000);
  const balAfter = await publicClient.getBalance({ address: vault.address });
  if (balAfter - balBefore !== parseEther("4"))
    fail(
      `vault balance rose ${formatEther(balAfter - balBefore)}, want 4 (chain payout)`,
    );
  console.log(
    "x/staking paid 4 AETHEL back into the vault — no claim tx needed ✓",
  );

  await write(vault, "syncUndelegations", [VALIDATOR], 0n, keeperClient);
  if ((await read(vault, "totalUnbonding")) !== 0n)
    fail("matured FIFO must release coverage");
  console.log("syncUndelegations: in-flight coverage released ✓");

  // ── 4. The queued exit is paid in full ───────────────────────────────────
  step("withdraw the queued 12 AETHEL");
  const userBefore = await publicClient.getBalance({
    address: account.address,
  });
  await write(vault, "withdraw", [wid]);
  const userAfter = await publicClient.getBalance({ address: account.address });
  if (userAfter - userBefore < parseEther("11.99"))
    fail("queued exit not paid in full");
  if ((await read(vault, "totalReserved")) !== 0n)
    fail("reservation not cleared");
  console.log(
    `withdrawal paid: +${formatEther(userAfter - userBefore)} AETHEL (net of gas) ✓`,
  );

  // ── 5. And the remaining delegation kept earning the whole time ──────────
  step("bonus: claim the yield earned during the wait");
  const pooledBefore = await read(vault, "totalPooledAethel");
  await write(vault, "claimStakingRewards", [VALIDATOR], 0n, keeperClient);
  const claimed = (await read(vault, "totalPooledAethel")) - pooledBefore;
  if (claimed <= 0n) fail("remaining delegation should have earned rewards");
  console.log(
    `claimed ${formatEther(claimed)} AETHEL of real yield on the remaining 8 ✓`,
  );

  step("summary");
  console.log("PHASE-2.5 QUEUE↔UNDELEGATION WIRING LIVE ON AETHELRED:");
  console.log(
    "  · queued exits beyond the buffer open a computed, bounded deficit",
  );
  console.log(
    "  · ANYONE undelegates exactly that deficit — governance not in the loop",
  );
  console.log(
    "  · the chain's real unbonding period runs and pays the vault back",
  );
  console.log(
    "  · the queued withdrawal is paid in full; reservations clear to zero",
  );
  console.log(
    "  · reconcileValidator reads real delegation/unbondingDelegation state",
  );
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));
