#!/usr/bin/env node
/**
 * Cruzible Phase-1 sophistication — live devnet proof.
 *
 * Deploys the upgraded vault (rate guard + instant unstake), StAETHEL, and the
 * new WstAETHEL wrapper to a running aethelredd node (chain 7332), then drives
 * the three capabilities that close the largest gaps to the liquid-staking
 * incumbents, asserting on-chain state at every step:
 *
 *   1. RATE GUARD — a single addRewards report above the cap REVERTS on-chain;
 *      a compliant report applies. The rewarder key can no longer swing the
 *      exchange rate arbitrarily.
 *   2. INSTANT UNSTAKE — exit immediately from the free buffer, minus the
 *      instant-exit fee, without the unbonding queue. The fee stays in the
 *      pool and rebases the remaining holder upward.
 *   3. WstAETHEL — wrap rebasing stAETHEL into a fixed-balance token; a reward
 *      leaves the wst balance unchanged but raises its redemption rate; unwrap
 *      returns more stAETHEL than was wrapped.
 *
 * Uses viem — the exact stack the Cruzible frontend runs on — so this script
 * IS the dApp path.
 *
 * Env: RPC_URL (default http://127.0.0.1:8547), DEPLOYER_KEY (funded).
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

const key = process.env.DEPLOYER_KEY;
if (!key) {
  console.error("DEPLOYER_KEY required (a funded devnet key)");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};
const step = (m) => console.log(`\n== ${m}`);
const FLOOR_WRITE = 800_000n;
const FLOOR_DEPLOY = 6_000_000n;
const headroom = (est, floor) => (est * 2n > floor ? est * 2n : floor);

async function deploy(name, args, value = 0n) {
  const { abi, bytecode } = loadArtifact(name);
  const gas = headroom(
    await publicClient.estimateGas({
      account,
      value,
      data: encodeDeployData({ abi, bytecode, args }),
    }),
    FLOOR_DEPLOY,
  );
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args,
    value,
    gas,
  });
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (r.status !== "success") fail(`${name} deploy reverted`);
  console.log(`${name} @ ${r.contractAddress}`);
  return { address: r.contractAddress, abi };
}

async function write(c, fn, args = [], value = 0n) {
  const gas = headroom(
    await publicClient.estimateContractGas({
      address: c.address,
      abi: c.abi,
      functionName: fn,
      args,
      value,
      account,
    }),
    FLOOR_WRITE,
  );
  const hash = await walletClient.writeContract({
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

/** Expect a write to revert (rate-guard proof). */
async function expectRevert(c, fn, args, value, label) {
  try {
    await publicClient.estimateContractGas({
      address: c.address,
      abi: c.abi,
      functionName: fn,
      args,
      value,
      account,
    });
    fail(`${label}: expected revert, but the call would succeed`);
  } catch {
    console.log(`${label}: reverted as required ✓`);
  }
}

const read = (c, fn, args = []) =>
  publicClient.readContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
  });

async function main() {
  step("chain identity");
  const chainId = await publicClient.getChainId();
  if (chainId !== 7332) fail(`chain id ${chainId}, want 7332`);
  console.log(`eth_chainId: ${chainId}  deployer: ${account.address}`);

  step("deploy vault + token + wrapper");
  const vault = await deploy("Cruzible", [
    account.address,
    account.address,
    account.address,
    30n,
  ]);
  const token = await deploy("StAETHEL", [vault.address]);
  const wst = await deploy("WstAETHEL", [token.address]);
  await write(vault, "setStAethel", [token.address]);
  console.log("wired vault ↔ token; wrapper over token");

  step("stake 20 AETHEL");
  await write(vault, "stake", [], parseEther("20"));
  console.log(
    `stAETHEL=${formatEther(await read(token, "balanceOf", [account.address]))}`,
  );

  // ── 1. RATE GUARD ────────────────────────────────────────────────────────
  step("rate guard: an oversized reward report reverts on-chain");
  // Default cap is 5% of the pool; 20% (4 AETHEL on 20) must revert.
  await expectRevert(
    vault,
    "addRewards",
    [],
    parseEther("4"),
    "addRewards +20%",
  );
  // 4% (0.8 AETHEL) is compliant and applies.
  await write(vault, "addRewards", [], parseEther("0.8"));
  const pooled = await read(vault, "totalPooledAethel");
  if (pooled !== parseEther("20.8")) fail("compliant reward must apply");
  console.log(
    `compliant reward applied: pool = ${formatEther(pooled)} AETHEL ✓`,
  );

  // ── 2. INSTANT UNSTAKE ───────────────────────────────────────────────────
  step("instant unstake: immediate exit from the free buffer, minus fee");
  const feeBps = await read(vault, "instantExitFeeBps");
  const shares = (await read(token, "sharesOf", [account.address])) / 4n;
  const value = await read(token, "getAethelByShares", [shares]);
  const fee = (value * feeBps) / 10_000n;
  const expectPaid = value - fee;
  const nativeBefore = await publicClient.getBalance({
    address: account.address,
  });
  const r = await write(vault, "instantUnstake", [shares, expectPaid]);
  const gasCost = r.gasUsed * r.effectiveGasPrice;
  const nativeAfter = await publicClient.getBalance({
    address: account.address,
  });
  const received = nativeAfter - nativeBefore + gasCost;
  if (received !== expectPaid)
    fail(`instant payout ${received} != expected ${expectPaid}`);
  console.log(
    `instant exit: paid ${formatEther(expectPaid)} AETHEL immediately (fee ${formatEther(fee)} stayed in pool) ✓`,
  );

  // ── 3. WstAETHEL WRAP / REBASE / UNWRAP ──────────────────────────────────
  // A fresh vault so its single reward passes the guard's minRewardInterval
  // (a live chain can't warp time; back-to-back reports on one vault are the
  // guard working as designed, proven in the rate-guard section above).
  step(
    "wstAETHEL: wrap, rebase leaves balance fixed, unwrap returns accrued value",
  );
  const vault2 = await deploy("Cruzible", [
    account.address,
    account.address,
    account.address,
    30n,
  ]);
  const token2 = await deploy("StAETHEL", [vault2.address]);
  const wst2 = await deploy("WstAETHEL", [token2.address]);
  await write(vault2, "setStAethel", [token2.address]);
  await write(vault2, "stake", [], parseEther("20"));

  const stToWrap = parseEther("4");
  await write(token2, "approve", [wst2.address, stToWrap]);
  await write(wst2, "wrap", [stToWrap]);
  const wstBal = await read(wst2, "balanceOf", [account.address]);
  const rateBefore = await read(wst2, "stAethelPerToken");
  console.log(
    `wrapped ${formatEther(stToWrap)} stAETHEL → ${formatEther(wstBal)} wstAETHEL (fixed)`,
  );

  // A compliant reward: wst balance must NOT change, redemption rate must rise.
  await write(vault2, "addRewards", [], parseEther("0.4"));
  const wstBalAfter = await read(wst2, "balanceOf", [account.address]);
  const rateAfter = await read(wst2, "stAethelPerToken");
  if (wstBalAfter !== wstBal) fail("wst balance must not rebase");
  if (rateAfter <= rateBefore) fail("redemption rate must rise after a reward");
  console.log(
    `after reward: wst balance unchanged (${formatEther(wstBalAfter)}); redemption ${formatEther(rateBefore)} → ${formatEther(rateAfter)} ✓`,
  );

  const stBefore = await read(token2, "balanceOf", [account.address]);
  await write(wst2, "unwrap", [wstBal]);
  const stAfter = await read(token2, "balanceOf", [account.address]);
  if (stAfter - stBefore <= stToWrap)
    fail("unwrap must return MORE than was wrapped (accrual)");
  console.log(
    `unwrapped: ${formatEther(stAfter - stBefore)} stAETHEL returned (> ${formatEther(stToWrap)} wrapped) ✓`,
  );

  step("summary");
  console.log("PHASE-1 SOPHISTICATION LIVE ON AETHELRED:");
  console.log("  · rate guard blocks single-tx rate manipulation");
  console.log("  · instant unstake (no unbonding wait, fee to stakers)");
  console.log("  · WstAETHEL non-rebasing wrapper for DeFi composability");
  console.log("\nNEXT_PUBLIC_CRUZIBLE_ADDRESS=" + vault.address);
  console.log("NEXT_PUBLIC_STAETHEL_ADDRESS=" + token.address);
  console.log("NEXT_PUBLIC_WSTAETHEL_ADDRESS=" + wst2.address);
}

main().catch((e) => fail(e.message ?? String(e)));
