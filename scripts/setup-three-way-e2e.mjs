#!/usr/bin/env node
/**
 * Setup for the wallet repo's THREE-WAY integration E2E
 * (apps/extension/e2e/three-way-integration.e2e.ts):
 *
 *   1. deploys the REAL ZeroID identity registry (zeroid repo artifact)
 *   2. deploys Cruzible + StAETHEL and turns the identity gate ON
 *   3. funds the spec's wallet account with native AETHEL
 *   4. prints the env block the Cruzible dev server and the spec consume
 *
 * Env: RPC_URL (default http://127.0.0.1:8547), DEPLOYER_KEY (funded),
 *      ZEROID_ARTIFACT (path to <zeroid>/foundry-out/ZeroID.sol/ZeroID.json),
 *      E2E_ACCOUNT (default anvil account 0 — what the spec imports),
 *      FUND_AETHEL (default "10").
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
const E2E_ACCOUNT =
  process.env.E2E_ACCOUNT ?? "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FUND = parseEther(process.env.FUND_AETHEL ?? "10");

const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};
for (const k of ["DEPLOYER_KEY", "ZEROID_ARTIFACT"]) {
  if (!process.env[k]) fail(`${k} required`);
}

const loadLocal = (name) => ({
  abi: JSON.parse(readFileSync(join(artifactsDir, `${name}.abi`), "utf8")),
  bytecode: `0x${readFileSync(join(artifactsDir, `${name}.bin`), "utf8").trim()}`,
});
const zeroIdArtifact = JSON.parse(
  readFileSync(process.env.ZEROID_ARTIFACT, "utf8"),
);
const zeroId = {
  abi: zeroIdArtifact.abi,
  bytecode: zeroIdArtifact.bytecode.object,
};

const chain = defineChain({
  id: 7332,
  name: "Aethelred Devnet",
  nativeCurrency: { name: "AETHEL", symbol: "AETHEL", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const account = privateKeyToAccount(process.env.DEPLOYER_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});
const headroom = (est, floor) => (est * 2n > floor ? est * 2n : floor);

async function deploy({ abi, bytecode }, args, label) {
  const gas = headroom(
    await publicClient.estimateGas({
      account,
      data: encodeDeployData({ abi, bytecode, args }),
    }),
    8_000_000n,
  );
  const hash = await walletClient.deployContract({ abi, bytecode, args, gas });
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (r.status !== "success") fail(`${label} deploy reverted`);
  console.log(`${label} @ ${r.contractAddress}`);
  return { address: r.contractAddress, abi };
}

async function write(c, fn, args) {
  const gas = headroom(
    await publicClient.estimateContractGas({
      address: c.address,
      abi: c.abi,
      functionName: fn,
      args,
      account,
    }),
    400_000n,
  );
  const hash = await walletClient.writeContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
    gas,
  });
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (r.status !== "success") fail(`${fn} reverted`);
}

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== 7332) fail(`chain id ${chainId}, want 7332`);

  const registry = await deploy(zeroId, [account.address], "ZeroID");
  const vault = await deploy(
    loadLocal("Cruzible"),
    [account.address, account.address, account.address, 30n],
    "Cruzible",
  );
  const token = await deploy(
    loadLocal("StAETHEL"),
    [vault.address],
    "StAETHEL",
  );
  await write(vault, "setStAethel", [token.address]);
  await write(vault, "setIdentityGate", [registry.address, true]);
  console.log("identity gate ON");

  const hash = await walletClient.sendTransaction({
    to: E2E_ACCOUNT,
    value: FUND,
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  const bal = await publicClient.getBalance({ address: E2E_ACCOUNT });
  console.log(`funded ${E2E_ACCOUNT}: ${formatEther(bal)} AETHEL`);

  console.log("\n== Cruzible dev server env");
  console.log(`NEXT_PUBLIC_CHAIN_ENV=devnet`);
  console.log(`NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL=${RPC_URL}`);
  console.log(`NEXT_PUBLIC_CRUZIBLE_ADDRESS=${vault.address}`);
  console.log(`NEXT_PUBLIC_STAETHEL_ADDRESS=${token.address}`);
  console.log("\n== spec env (wallet repo)");
  console.log(`THREE_WAY_INTEGRATION=1`);
  console.log(`CRUZIBLE_RPC=${RPC_URL}`);
  console.log(`CRUZIBLE_STAETHEL_ADDRESS=${token.address}`);
  console.log(`ZEROID_REGISTRY_ADDRESS=${registry.address}`);
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));
