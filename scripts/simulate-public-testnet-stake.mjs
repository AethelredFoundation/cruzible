#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  defineChain,
  formatEther,
  http,
  isAddress,
  parseEther,
} from "viem";

const EXPECTED_CHAIN_ID = 7332;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDirectory = join(
  __dirname,
  "..",
  "backend",
  "contracts-evm",
  "artifacts",
);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizedAddress(value, label) {
  if (!isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} must be a non-zero EVM address`);
  }
  return value.toLowerCase();
}

function loadAbi(name) {
  return JSON.parse(
    readFileSync(join(artifactsDirectory, `${name}.abi`), "utf8"),
  );
}

export async function simulatePublicTestnetStake({
  publicClient,
  cruzibleAddress,
  stAethelAddress,
  expectedGenesisHash,
  expectedUnbondingPeriodSeconds = 3600n,
  testStakerAddress,
  stakeAmountWei = parseEther("1"),
  cruzibleAbi = loadAbi("Cruzible"),
  stAethelAbi = loadAbi("StAETHEL"),
}) {
  const vault = normalizedAddress(cruzibleAddress, "CRUZIBLE_ADDRESS");
  const token = normalizedAddress(stAethelAddress, "STAETHEL_ADDRESS");
  const staker = normalizedAddress(testStakerAddress, "TEST_STAKER_ADDRESS");
  if (!HASH_PATTERN.test(expectedGenesisHash)) {
    throw new Error("EXPECTED_GENESIS_HASH must be a 32-byte EVM block hash");
  }
  if (stakeAmountWei <= 0n) {
    throw new Error("STAKE_AMOUNT_WEI must be greater than zero");
  }

  const chainId = await publicClient.getChainId();
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `connected chain id ${chainId}, expected ${EXPECTED_CHAIN_ID}`,
    );
  }

  const anchorBlock = await publicClient.getBlock({ blockNumber: 1n });
  if (
    anchorBlock.number !== 1n ||
    anchorBlock.hash?.toLowerCase() !== expectedGenesisHash.toLowerCase()
  ) {
    throw new Error("canonical EVM anchor block 1 does not match");
  }

  const [vaultCode, tokenCode] = await Promise.all([
    publicClient.getBytecode({ address: vault }),
    publicClient.getBytecode({ address: token }),
  ]);
  if (!vaultCode || /^0x0*$/u.test(vaultCode)) {
    throw new Error("CRUZIBLE_ADDRESS has no runtime bytecode");
  }
  if (!tokenCode || /^0x0*$/u.test(tokenCode)) {
    throw new Error("STAETHEL_ADDRESS has no runtime bytecode");
  }

  const [
    configuredToken,
    configuredVault,
    exchangeRate,
    unbondingPeriod,
    depositsPaused,
    uncoveredDeficit,
    identityRequired,
    complianceRequired,
  ] = await Promise.all([
    publicClient.readContract({
      address: vault,
      abi: cruzibleAbi,
      functionName: "stAethel",
    }),
    publicClient.readContract({
      address: token,
      abi: stAethelAbi,
      functionName: "vault",
    }),
    publicClient.readContract({
      address: vault,
      abi: cruzibleAbi,
      functionName: "getExchangeRate",
    }),
    publicClient.readContract({
      address: vault,
      abi: cruzibleAbi,
      functionName: "unbondingPeriod",
    }),
    publicClient.readContract({
      address: vault,
      abi: cruzibleAbi,
      functionName: "depositsPaused",
    }),
    publicClient.readContract({
      address: vault,
      abi: cruzibleAbi,
      functionName: "uncoveredDeficit",
    }),
    publicClient.readContract({
      address: vault,
      abi: cruzibleAbi,
      functionName: "identityRequired",
    }),
    publicClient.readContract({
      address: vault,
      abi: cruzibleAbi,
      functionName: "complianceRequired",
    }),
  ]);

  if (String(configuredToken).toLowerCase() !== token) {
    throw new Error("vault stAETHEL wiring does not match STAETHEL_ADDRESS");
  }
  if (String(configuredVault).toLowerCase() !== vault) {
    throw new Error("stAETHEL vault wiring does not match CRUZIBLE_ADDRESS");
  }
  if (typeof exchangeRate !== "bigint" || exchangeRate <= 0n) {
    throw new Error("vault exchange rate is unavailable or invalid");
  }
  if (unbondingPeriod !== expectedUnbondingPeriodSeconds) {
    throw new Error(
      `vault unbonding period ${unbondingPeriod} does not match expected ${expectedUnbondingPeriodSeconds}`,
    );
  }
  if (depositsPaused !== false) {
    throw new Error("vault deposits are paused");
  }
  if (uncoveredDeficit !== 0n) {
    throw new Error(`vault has uncovered deficit ${uncoveredDeficit}`);
  }
  if (identityRequired !== false || complianceRequired !== false) {
    throw new Error(
      "plain-stake release gate requires the ZeroID and Digital Seal admission gates to be disabled",
    );
  }

  const balance = await publicClient.getBalance({ address: staker });
  if (balance <= stakeAmountWei) {
    throw new Error(
      `test staker needs more than ${formatEther(stakeAmountWei)} AETHEL so gas remains available`,
    );
  }

  const simulation = await publicClient.simulateContract({
    address: vault,
    abi: cruzibleAbi,
    functionName: "stakeWithMinShares",
    args: [0n],
    account: staker,
    value: stakeAmountWei,
  });

  return {
    chainId,
    exchangeRate,
    unbondingPeriod,
    simulatedShares: simulation.result,
    stakeAmountWei,
  };
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliEntrypoint) {
  try {
    const rpcUrl = requiredEnv("RPC_URL");
    const expectedGenesisHash = requiredEnv("EXPECTED_GENESIS_HASH");
    const stakeAmountWei = process.env.STAKE_AMOUNT_WEI?.trim()
      ? BigInt(process.env.STAKE_AMOUNT_WEI)
      : parseEther("1");
    const expectedUnbondingPeriodSeconds =
      process.env.EXPECTED_UNBONDING_PERIOD_SECONDS?.trim()
        ? BigInt(process.env.EXPECTED_UNBONDING_PERIOD_SECONDS)
        : 3600n;
    const chain = defineChain({
      id: EXPECTED_CHAIN_ID,
      name: "Aethelred Public Testnet",
      nativeCurrency: { name: "AETHEL", symbol: "AETHEL", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl, { retryCount: 3, timeout: 15_000 }),
    });

    const result = await simulatePublicTestnetStake({
      publicClient,
      cruzibleAddress: requiredEnv("CRUZIBLE_ADDRESS"),
      stAethelAddress: requiredEnv("STAETHEL_ADDRESS"),
      expectedGenesisHash,
      expectedUnbondingPeriodSeconds,
      testStakerAddress: requiredEnv("TEST_STAKER_ADDRESS"),
      stakeAmountWei,
    });
    console.log(
      `Read-only stake simulation passed on chain ${result.chainId}: ${formatEther(result.stakeAmountWei)} AETHEL would mint ${formatEther(result.simulatedShares)} raw shares; no transaction was broadcast.`,
    );
  } catch (error) {
    console.error(`Read-only stake simulation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
