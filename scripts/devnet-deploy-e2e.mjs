#!/usr/bin/env node
/**
 * Cruzible devnet deploy + end-to-end proof against a live aethelredd node.
 *
 * Uses viem — the exact stack the Cruzible frontend runs on — so this script
 * IS the dApp path: deploy StAETHEL + Cruzible to the Aethelred EVM
 * (chain id 7332), then drive the full liquid-staking lifecycle:
 *
 *   stake (native AETHEL) → rebasing stAETHEL → addRewards (balance rebases up)
 *   → epoch checkpoints (computed APY) → unstake (unbonding queue) → withdraw
 *
 * Usage:
 *   node scripts/devnet-deploy-e2e.mjs
 *     RPC_URL         (default http://127.0.0.1:8545)
 *     DEPLOYER_KEY    hex private key; generated if unset (fund the printed
 *                     address with `aethelredd tx bank send ...`, the script
 *                     waits for funding)
 *     UNBONDING_SECS  withdrawal queue delay (default 20 for devnet)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(
  __dirname,
  "..",
  "backend",
  "contracts-evm",
  "artifacts",
);

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const UNBONDING_SECS = BigInt(process.env.UNBONDING_SECS ?? "20");

const loadArtifact = (name) => ({
  abi: JSON.parse(readFileSync(join(artifactsDir, `${name}.abi`), "utf8")),
  bytecode: `0x${readFileSync(join(artifactsDir, `${name}.bin`), "utf8").trim()}`,
});

const aethelredDevnet = defineChain({
  id: 7332,
  name: "Aethelred Devnet",
  nativeCurrency: { name: "AETHEL", symbol: "AETHEL", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const key = process.env.DEPLOYER_KEY ?? generatePrivateKey();
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({
  chain: aethelredDevnet,
  transport: http(RPC_URL),
});
const walletClient = createWalletClient({
  account,
  chain: aethelredDevnet,
  transport: http(RPC_URL),
});

// Minimal bech32 encoder (BIP-173) — inlined to avoid a new dependency; used
// only to print the cosmos-side funding address for the deployer.
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const bech32Polymod = (values) => {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
};
const bech32HrpExpand = (hrp) => [
  ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
  0,
  ...[...hrp].map((c) => c.charCodeAt(0) & 31),
];
const toWords = (bytes) => {
  const words = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
};
const toBech32 = (hexAddr) => {
  const hrp = "aethel";
  const words = toWords(Buffer.from(hexAddr.slice(2), "hex"));
  const poly =
    bech32Polymod([...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from(
    { length: 6 },
    (_, i) => (poly >> (5 * (5 - i))) & 31,
  );
  return `${hrp}1${[...words, ...checksum].map((w) => BECH32_CHARSET[w]).join("")}`;
};

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const step = (msg) => console.log(`\n== ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFunding() {
  const deadline = Date.now() + 300_000;
  for (;;) {
    const bal = await publicClient.getBalance({ address: account.address });
    if (bal > 0n) return bal;
    if (Date.now() > deadline)
      fail(`deployer ${account.address} not funded in 300s`);
    await sleep(2000);
  }
}

async function deploy(name, args, value = 0n) {
  const { abi, bytecode } = loadArtifact(name);
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args,
    value,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (receipt.status !== "success") fail(`${name} deployment reverted`);
  console.log(
    `${name} deployed at ${receipt.contractAddress} (block ${receipt.blockNumber})`,
  );
  return { address: receipt.contractAddress, abi };
}

async function write(contract, functionName, args = [], value = 0n) {
  const hash = await walletClient.writeContract({
    address: contract.address,
    abi: contract.abi,
    functionName,
    args,
    value,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (receipt.status !== "success") fail(`${functionName} reverted`);
  return receipt;
}

const read = (contract, functionName, args = []) =>
  publicClient.readContract({
    address: contract.address,
    abi: contract.abi,
    functionName,
    args,
  });

async function main() {
  step("chain identity");
  const chainId = await publicClient.getChainId();
  if (chainId !== 7332) fail(`chain id ${chainId}, want 7332`);
  console.log(`eth_chainId: ${chainId}`);

  step("deployer funding");
  console.log(`deployer 0x     : ${account.address}`);
  console.log(`deployer bech32 : ${toBech32(account.address)}`);
  console.log(
    `fund with       : aethelredd tx bank send validator ${toBech32(account.address)} 20000000000uaethel ...`,
  );
  const bal = await waitForFunding();
  console.log(`funded          : ${formatEther(bal)} AETHEL`);

  step("deploy vault + token");
  const vault = await deploy("Cruzible", [
    account.address, // governance
    account.address, // rewarder
    account.address, // pauser
    UNBONDING_SECS,
  ]);
  const token = await deploy("StAETHEL", [vault.address]);
  await write(vault, "setStAethel", [token.address]);
  console.log("vault ↔ token wired");

  step("stake 5 AETHEL (native)");
  await write(vault, "stake", [], parseEther("5"));
  const shares0 = await read(token, "sharesOf", [account.address]);
  const bal0 = await read(token, "balanceOf", [account.address]);
  const rate0 = await read(vault, "getExchangeRate");
  console.log(
    `shares=${shares0} stAETHEL=${formatEther(bal0)} rate=${formatEther(rate0)}`,
  );
  if (shares0 !== parseEther("5")) fail("bootstrap shares must equal deposit");
  if (bal0 !== parseEther("5")) fail("bootstrap balance must equal deposit");

  step("rewards rebase every balance (addRewards 1 AETHEL)");
  await write(vault, "addRewards", [], parseEther("1"));
  const bal1 = await read(token, "balanceOf", [account.address]);
  const rate1 = await read(vault, "getExchangeRate");
  console.log(`stAETHEL=${formatEther(bal1)} rate=${formatEther(rate1)}`);
  if (bal1 !== parseEther("6"))
    fail(`balance must rebase to 6, got ${formatEther(bal1)}`);
  if (rate1 !== parseEther("1.2"))
    fail(`rate must be 1.2, got ${formatEther(rate1)}`);

  step("epoch checkpoints → computed APY");
  await write(vault, "advanceEpoch");
  await sleep(4000); // real elapsed time between checkpoints
  await write(vault, "addRewards", [], parseEther("0.1"));
  await write(vault, "advanceEpoch");
  const apy = await read(vault, "effectiveAPY");
  console.log(`effectiveAPY: ${apy} bps (computed from on-chain rate history)`);
  if (apy === 0n)
    fail("APY must be computed > 0 after rate growth between checkpoints");

  step("unstake half → unbonding queue");
  const half = shares0 / 2n;
  await write(vault, "unstake", [half]);
  const withdrawals = await read(vault, "getUserWithdrawals", [
    account.address,
  ]);
  const w = withdrawals[0];
  console.log(
    `withdrawal id=${w.id} amount=${formatEther(w.aethelAmount)} claimable at ${w.completionTime}`,
  );
  const claimableEarly = await read(vault, "isWithdrawalClaimable", [
    account.address,
    w.id,
  ]);
  if (claimableEarly)
    fail("withdrawal must NOT be claimable before the unbonding period");

  step(`wait unbonding (${UNBONDING_SECS}s) → withdraw`);
  await sleep(Number(UNBONDING_SECS) * 1000 + 6000); // + a block of margin
  const before = await publicClient.getBalance({ address: account.address });
  await write(vault, "withdraw", [w.id]);
  const after = await publicClient.getBalance({ address: account.address });
  console.log(
    `native balance delta ≈ ${formatEther(after - before)} AETHEL (minus gas)`,
  );
  if (after <= before) fail("withdraw must pay out native AETHEL");

  step("summary");
  console.log(`NEXT_PUBLIC_CHAIN_ENV=devnet`);
  console.log(`NEXT_PUBLIC_CRUZIBLE_ADDRESS=${vault.address}`);
  console.log(`NEXT_PUBLIC_STAETHEL_ADDRESS=${token.address}`);
  console.log(
    "\nCRUZIBLE LIQUID STAKING LIVE ON AETHELRED: stake → rebase → APY → unbond → withdraw all proven.",
  );
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));
