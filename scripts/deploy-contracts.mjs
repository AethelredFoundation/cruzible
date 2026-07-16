#!/usr/bin/env node
/**
 * Cruzible — contract deployment (testnet/devnet).
 *
 * Deploys the EVM contract suite from the COMMITTED, reproducible artifacts
 * (backend/contracts-evm/artifacts — solc 0.8.20, optimizer 200, shanghai;
 * rebuild with backend/contracts-evm/build.sh only if you change sources):
 *
 *   1. Cruzible   — the liquid-staking vault (native AETHEL, payable stake)
 *   2. StAETHEL   — rebasing receipt token (vault is sole minter/burner)
 *   3. WstAETHEL  — non-rebasing wrapper (wstETH pattern, EIP-2612 permit)
 *
 * Wiring: setStAethel is one-time and governance-only, so the vault is
 * deployed with the DEPLOYER as governance, wired, then — if GOVERNANCE is
 * set to a different address — a two-step transfer is STARTED (the new
 * governance must call acceptGovernance() to take over; nothing changes
 * until it does). Same admin-separation pattern as the ZeroID deploy.
 *
 * Usage:
 *   RPC_URL=http://54.165.44.130:8545 \
 *   DEPLOYER_KEY=0x<funded-private-key> \
 *   node scripts/deploy-contracts.mjs
 *
 * Optional env:
 *   GOVERNANCE                 nominate this address as governance (two-step)
 *   REWARDER, PAUSER           role addresses (default: deployer)
 *   UNBONDING_PERIOD_SECONDS   withdrawal-queue delay (default 3600 = 1h for
 *                              testing; set 1814400 = 21d when delegation to
 *                              the chain's validators goes live, so the vault
 *                              queue mirrors the chain's unbonding period)
 *   SKIP_WSTAETHEL=1           don't deploy the wrapper
 *   ZEROID_REGISTRY            deployed ZeroID registry address — turns the
 *                              identity gate ON (staking requires a
 *                              registered, ACTIVE ZeroID identity; exits are
 *                              never gated)
 *   OUT=<path>                 also write the deployment manifest JSON here
 *
 * Gas: every tx is estimated on-chain and sent with 2x headroom (the same
 * safety margin as forge's --gas-estimate-multiplier 200), and receipts are
 * awaited sequentially (equivalent to forge --slow).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  formatEther,
  http,
  isAddress,
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

const RPC_URL = process.env.RPC_URL;
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;
if (!RPC_URL || !DEPLOYER_KEY) {
  console.error("RPC_URL and DEPLOYER_KEY are required");
  console.error(
    "  RPC_URL=http://54.165.44.130:8545 DEPLOYER_KEY=0x... node scripts/deploy-contracts.mjs",
  );
  process.exit(1);
}
const UNBONDING = BigInt(process.env.UNBONDING_PERIOD_SECONDS ?? "3600");

const fail = (m) => {
  console.error(`\nFAIL: ${m}`);
  process.exit(1);
};

for (const [name, value] of [
  ["GOVERNANCE", process.env.GOVERNANCE],
  ["REWARDER", process.env.REWARDER],
  ["PAUSER", process.env.PAUSER],
]) {
  if (value && !isAddress(value))
    fail(`${name} is not a valid EVM address: ${value}`);
}

const loadArtifact = (name) => ({
  abi: JSON.parse(readFileSync(join(artifactsDir, `${name}.abi`), "utf8")),
  bytecode: `0x${readFileSync(join(artifactsDir, `${name}.bin`), "utf8").trim()}`,
});

const chain = defineChain({
  id: 7332,
  name: "Aethelred",
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
    timeout: 120_000,
  });
  if (r.status !== "success") fail(`${name} deploy reverted (tx ${hash})`);
  console.log(
    `  ${name.padEnd(10)} ${r.contractAddress}  (block ${r.blockNumber}, gas ${r.gasUsed})`,
  );
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
    timeout: 120_000,
  });
  if (r.status !== "success") fail(`${fn} reverted (tx ${hash})`);
  return r;
}

const read = (c, fn, args = []) =>
  publicClient.readContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
  });

async function main() {
  console.log("== preflight");
  const chainId = await publicClient.getChainId();
  if (chainId !== 7332)
    fail(`connected chain id ${chainId}, want 7332 (Aethelred)`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(
    `  chain 7332 ✓  deployer ${account.address}  balance ${formatEther(balance)} AETHEL`,
  );
  if (balance === 0n)
    fail("deployer has no AETHEL for gas — fund it first (see the guide)");

  const rewarder = process.env.REWARDER ?? account.address;
  const pauser = process.env.PAUSER ?? account.address;

  console.log(`== deploy (unbonding period ${UNBONDING}s)`);
  // Governance starts as the deployer so the one-time setStAethel wiring can
  // run; a different GOVERNANCE is nominated afterwards (two-step).
  const vault = await deploy("Cruzible", [
    account.address,
    rewarder,
    pauser,
    UNBONDING,
  ]);
  const token = await deploy("StAETHEL", [vault.address]);
  await write(vault, "setStAethel", [token.address]);
  const wst = process.env.SKIP_WSTAETHEL
    ? null
    : await deploy("WstAETHEL", [token.address]);

  console.log("== sanity");
  if (
    (await read(vault, "stAethel")).toLowerCase() !==
    token.address.toLowerCase()
  )
    fail("stAETHEL wiring mismatch");
  if ((await read(vault, "getExchangeRate")) !== 10n ** 18n)
    fail("fresh vault exchange rate must be exactly 1.0");
  if ((await read(vault, "unbondingPeriod")) !== UNBONDING)
    fail("unbonding period mismatch");
  console.log("  wiring ✓  exchange rate 1.0 ✓");

  // Optional ZeroID identity gate: point the vault at a deployed ZeroID
  // registry so staking requires a registered, ACTIVE identity (exits are
  // never gated). Must run before any governance handover.
  if (process.env.ZEROID_REGISTRY) {
    if (!isAddress(process.env.ZEROID_REGISTRY))
      fail(
        `ZEROID_REGISTRY is not a valid EVM address: ${process.env.ZEROID_REGISTRY}`,
      );
    await write(vault, "setIdentityGate", [process.env.ZEROID_REGISTRY, true]);
    console.log(
      `  identity gate ON → ZeroID registry ${process.env.ZEROID_REGISTRY}`,
    );
  }

  let governanceNote = `governance: ${account.address} (deployer)`;
  if (
    process.env.GOVERNANCE &&
    process.env.GOVERNANCE.toLowerCase() !== account.address.toLowerCase()
  ) {
    await write(vault, "transferGovernance", [process.env.GOVERNANCE]);
    governanceNote = `governance transfer STARTED to ${process.env.GOVERNANCE} — it must call acceptGovernance() to take over`;
    console.log(`  ${governanceNote}`);
  }

  const manifest = {
    chainId: 7332,
    rpcUrl: RPC_URL,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      Cruzible: vault.address,
      StAETHEL: token.address,
      ...(wst ? { WstAETHEL: wst.address } : {}),
    },
    roles: {
      governance: process.env.GOVERNANCE ?? account.address,
      rewarder,
      pauser,
    },
    unbondingPeriodSeconds: Number(UNBONDING),
    ...(process.env.ZEROID_REGISTRY
      ? {
          identityGate: {
            registry: process.env.ZEROID_REGISTRY,
            required: true,
          },
        }
      : {}),
  };
  if (process.env.OUT) {
    mkdirSync(dirname(process.env.OUT), { recursive: true });
    writeFileSync(process.env.OUT, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`== manifest written to ${process.env.OUT}`);
  }

  console.log("\n== paste into .env.local (frontend)");
  console.log(`NEXT_PUBLIC_CRUZIBLE_ADDRESS=${vault.address}`);
  console.log(`NEXT_PUBLIC_STAETHEL_ADDRESS=${token.address}`);
  console.log("\n== backend/api env (only if you run the API)");
  console.log(`CRUZIBLE_VAULT_ADDRESS=${vault.address}`);
  console.log(`STAETHEL_ADDRESS=${token.address}`);
  if (wst)
    console.log(
      `\n== wstAETHEL (integrations/AMMs; no frontend env var)\nWSTAETHEL_ADDRESS=${wst.address}`,
    );
  console.log(`\n${governanceNote}`);
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));
