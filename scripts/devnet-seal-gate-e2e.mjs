#!/usr/bin/env node
/**
 * Cruzible seal-gated compliance E2E — the Aethelred moat, live.
 *
 * Proves the flow no other liquid-staking protocol can offer: staking entry
 * gated by a Digital Seal minted by the chain's own attested-compute (PoUW)
 * pipeline, policy-checked by consensus logic via the ISeal precompile:
 *
 *   1. governance enables compliance mode + CEAP policy
 *   2. plain stake() REVERTS — the gate is closed
 *   3. a PoUW compliance job runs on-chain with purpose
 *      `cruzible-stake:0x<staker>` → validators verify → quorum mints the
 *      Digital Seal (driven by the operator via the aethelredd CLI; this
 *      script prints the exact command)
 *   4. stakeWithSeal(JOB_ID) verifies the seal via ISeal (ACTIVE + purpose
 *      bound to THIS staker + CEAP policy satisfied) and admits + stakes
 *
 * This is an operator playbook: it automates every EVM-side step and, when the
 * PoUW seal is ready, pass its JOB_ID to complete admission. Without JOB_ID it
 * stops after proving the gate is closed and printing the mint command.
 *
 * Env: CRUZIBLE_ADDRESS, DEPLOYER_KEY (funded; also governance), RPC_URL,
 *      JOB_ID (the completed PoUW job whose seal admits the staker).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
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

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CRUZIBLE_ADDRESS = process.env.CRUZIBLE_ADDRESS;
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;
const JOB_ID = process.env.JOB_ID ?? "";

if (!CRUZIBLE_ADDRESS || !DEPLOYER_KEY) {
  console.error("CRUZIBLE_ADDRESS and DEPLOYER_KEY are required");
  process.exit(2);
}

const abi = JSON.parse(
  readFileSync(join(artifactsDir, "Cruzible.abi"), "utf8"),
);

const chain = defineChain({
  id: 7332,
  name: "Aethelred Devnet",
  nativeCurrency: { name: "AETHEL", symbol: "AETHEL", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const account = privateKeyToAccount(DEPLOYER_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const step = (msg) => console.log(`\n== ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function write(functionName, args = [], value = 0n, from = walletClient) {
  const hash = await from.writeContract({
    address: CRUZIBLE_ADDRESS,
    abi,
    functionName,
    args,
    value,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (receipt.status !== "success") fail(`${functionName} reverted on-chain`);
  return receipt;
}

async function expectRevert(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(
      `${label}: reverted as required (${(e.shortMessage ?? e.message).split("\n")[0]})`,
    );
    return;
  }
  fail(`${label}: expected revert but succeeded`);
}

const read = (functionName, args = []) =>
  publicClient.readContract({
    address: CRUZIBLE_ADDRESS,
    abi,
    functionName,
    args,
  });

async function main() {
  const staker = account.address.toLowerCase();
  const purpose = `cruzible-stake:${staker}`;

  step("chain identity");
  const chainId = await publicClient.getChainId();
  if (chainId !== 7332) fail(`chain id ${chainId}, want 7332`);
  console.log(`eth_chainId: ${chainId}  staker: ${staker}`);

  step(
    "governance: enable compliance mode + CEAP policy (fhe backend, EU residency)",
  );
  await write("setComplianceRequired", [true]);
  await write("setCompliancePolicy", [["fhe"], "", [], false, ["EU"]]);
  console.log("compliance mode ON");

  step("gate is closed: plain stake() must revert");
  await expectRevert("plain stake()", () =>
    write("stake", [], parseEther("1")),
  );

  if (!JOB_ID) {
    step("mint the admission seal (operator step)");
    console.log(
      "Run a PoUW compliance job bound to this staker, then re-run with JOB_ID set:\n",
    );
    console.log(
      `  aethelredd tx pouw register-model --model cruzible-kyc-v1 --model-id cruzible-kyc \\\n` +
        `    --from validator --chain-id <id> --keyring-backend test --yes`,
    );
    console.log(
      `  aethelredd tx pouw submit-job --model cruzible-kyc-v1 --input applicant-${staker} \\\n` +
        `    --proof-type tee --purpose "${purpose}" \\\n` +
        `    --conf-backends fhe --conf-residency EU \\\n` +
        `    --from validator --chain-id <id> --keyring-backend test --yes`,
    );
    console.log(
      `\nWait for the quorum-minted seal, then:\n  JOB_ID=<job-id> CRUZIBLE_ADDRESS=${CRUZIBLE_ADDRESS} \\\n` +
        `    DEPLOYER_KEY=<key> node scripts/devnet-seal-gate-e2e.mjs`,
    );
    console.log(
      "\nGATE PROVEN CLOSED. Provide JOB_ID to complete seal-gated admission.",
    );
    return;
  }

  step(`stakeWithSeal(${JOB_ID}) — verify seal via ISeal + admit + stake`);
  await write("stakeWithSeal", [JOB_ID], parseEther("1"));
  const admitted = await read("complianceAdmitted", [account.address]);
  if (!admitted) fail("staker was not admitted after stakeWithSeal");
  console.log("staker admitted via Digital Seal ✓");

  step("admitted staker can now stake() directly");
  await write("stake", [], parseEther("1"));

  console.log(
    "\nSEAL-GATED COMPLIANT STAKING LIVE: gate closed → seal admits → staking open. The Aethelred moat, end-to-end.",
  );
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));
