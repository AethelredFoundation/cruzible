#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvmDeploymentManifest } from "./lib/evm-deployment-manifest.mjs";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const EMPTY_CODE = /^0x0*$/u;
const CONTRACTS = ["Cruzible", "StAETHEL"];
const ST_AETHEL_SELECTOR = "0x9fb11263";
const VAULT_SELECTOR = "0xfbfa77cf";
const SET_ST_AETHEL_SELECTOR = "0x381f5775";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Hex(value) {
  const normalized = String(value).replace(/^0x/u, "");
  if (!/^(?:[0-9a-fA-F]{2})*$/u.test(normalized)) {
    throw new Error("bytecode must be even-length hexadecimal");
  }
  return sha256(Buffer.from(normalized, "hex"));
}

function normalizeAddress(value, label) {
  if (!ADDRESS_PATTERN.test(value ?? "")) {
    throw new Error(`${label} must be a non-zero EVM address`);
  }
  if (/^0x0{40}$/iu.test(value)) {
    throw new Error(`${label} must be a non-zero EVM address`);
  }
  return value.toLowerCase();
}

function decodeAddressWord(value, label) {
  const normalized = String(value).replace(/^0x/u, "");
  if (!/^[0-9a-fA-F]{64}$/u.test(normalized)) {
    throw new Error(`${label} did not return one ABI address word`);
  }
  return normalizeAddress(`0x${normalized.slice(24)}`, label);
}

function sameBlockNumber(rpcHex, manifestDecimal) {
  try {
    return BigInt(rpcHex) === BigInt(manifestDecimal);
  } catch {
    return false;
  }
}

function loadArtifacts(repoRoot) {
  const artifactDirectory = join(
    repoRoot,
    "backend",
    "contracts-evm",
    "artifacts",
  );
  return Object.fromEntries(
    CONTRACTS.map((name) => {
      const abiBytes = readFileSync(join(artifactDirectory, `${name}.abi`));
      const creationBytes = readFileSync(
        join(artifactDirectory, `${name}.bin`),
      );
      const creationBytecode = creationBytes.toString("utf8").trim();
      return [
        name,
        {
          abiFileSha256: sha256(abiBytes),
          creationBytecodeFileSha256: sha256(creationBytes),
          creationBytecodeSha256: sha256Hex(creationBytecode),
          creationBytecode: `0x${creationBytecode}`.toLowerCase(),
        },
      ];
    }),
  );
}

async function defaultRpc({ rpcUrl, method, params }) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${method} failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(
      `${method} failed: ${payload.error.message ?? "RPC error"}`,
    );
  }
  return payload.result;
}

function assertStaticBinding({
  manifest,
  environment,
  chainId,
  rpcUrl,
  addresses,
  artifacts,
}) {
  const { errors } = validateEvmDeploymentManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`deployment manifest is invalid: ${errors.join("; ")}`);
  }
  if (manifest.environment !== environment) {
    throw new Error(
      "deployment manifest environment does not match the frontend release",
    );
  }
  if (manifest.source.clean !== true) {
    throw new Error(
      "release deployment must have been produced from a clean tracked worktree",
    );
  }
  if (manifest.chain.chainId !== chainId) {
    throw new Error(
      "deployment manifest chain ID does not match the frontend release",
    );
  }
  if (manifest.chain.rpcOrigin !== new URL(rpcUrl).origin) {
    throw new Error(
      "deployment manifest RPC origin does not match the frontend release RPC",
    );
  }

  for (const name of CONTRACTS) {
    const expectedAddress = addresses[name];
    const deployed = manifest.contracts[name];
    if (
      normalizeAddress(deployed.address, `${name} manifest address`) !==
      expectedAddress
    ) {
      throw new Error(
        `${name} manifest address does not match the frontend release`,
      );
    }
    for (const hashName of [
      "abiFileSha256",
      "creationBytecodeFileSha256",
      "creationBytecodeSha256",
    ]) {
      if (deployed.hashes[hashName] !== artifacts[name][hashName]) {
        throw new Error(
          `${name} deployment was not created from the current committed ${hashName} artifact`,
        );
      }
    }
  }
}

async function assertDeploymentTransaction({
  name,
  manifest,
  artifacts,
  rpcUrl,
  rpc,
}) {
  const deployed = manifest.contracts[name];
  const [transaction, receipt] = await Promise.all([
    rpc({
      rpcUrl,
      method: "eth_getTransactionByHash",
      params: [deployed.deployTxHash],
    }),
    rpc({
      rpcUrl,
      method: "eth_getTransactionReceipt",
      params: [deployed.deployTxHash],
    }),
  ]);
  if (!transaction || !receipt) {
    throw new Error(
      `${name} deployment transaction evidence is unavailable from RPC`,
    );
  }
  const input = String(
    transaction.input ?? transaction.data ?? "",
  ).toLowerCase();
  if (!input.startsWith(artifacts[name].creationBytecode)) {
    throw new Error(
      `${name} deployment transaction does not use current creation bytecode`,
    );
  }
  if (transaction.to !== null && transaction.to !== undefined) {
    throw new Error(`${name} deployment transaction must be contract creation`);
  }
  if (
    normalizeAddress(receipt.contractAddress, `${name} receipt address`) !==
    normalizeAddress(deployed.address, `${name} manifest address`)
  ) {
    throw new Error(
      `${name} deployment receipt address does not match the manifest`,
    );
  }
  if (String(receipt.status).toLowerCase() !== "0x1") {
    throw new Error(`${name} deployment transaction did not succeed`);
  }
  if (!sameBlockNumber(receipt.blockNumber, deployed.blockNumber)) {
    throw new Error(
      `${name} deployment receipt block does not match the manifest`,
    );
  }

  if (name === "StAETHEL") {
    const constructorArgs = input.slice(
      artifacts[name].creationBytecode.length,
    );
    const vaultArgument = decodeAddressWord(
      `0x${constructorArgs.slice(-64)}`,
      "StAETHEL constructor vault",
    );
    if (
      vaultArgument !==
      normalizeAddress(manifest.contracts.Cruzible.address, "Cruzible address")
    ) {
      throw new Error(
        "StAETHEL deployment is not bound to the released Cruzible vault",
      );
    }
  }
}

export async function validateReleaseEvmDeployment({
  manifest,
  environment,
  chainId,
  rpcUrl,
  cruzibleAddress,
  stAethelAddress,
  expectedGenesisHash,
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  rpc = defaultRpc,
}) {
  const addresses = {
    Cruzible: normalizeAddress(cruzibleAddress, "NEXT_PUBLIC_CRUZIBLE_ADDRESS"),
    StAETHEL: normalizeAddress(stAethelAddress, "NEXT_PUBLIC_STAETHEL_ADDRESS"),
  };
  const artifacts = loadArtifacts(repoRoot);
  assertStaticBinding({
    manifest,
    environment,
    chainId,
    rpcUrl,
    addresses,
    artifacts,
  });
  if (
    String(expectedGenesisHash).toLowerCase() !==
    manifest.chain.genesisBlockHash.toLowerCase()
  ) {
    throw new Error(
      "frontend genesis hash does not match the deployment manifest",
    );
  }

  const chainIdHex = await rpc({ rpcUrl, method: "eth_chainId", params: [] });
  if (BigInt(chainIdHex) !== BigInt(chainId)) {
    throw new Error("live RPC chain ID does not match the frontend release");
  }
  const genesis = await rpc({
    rpcUrl,
    method: "eth_getBlockByNumber",
    params: ["0x1", false],
  });
  if (
    genesis?.number !== "0x1" ||
    String(genesis?.hash).toLowerCase() !==
      manifest.chain.genesisBlockHash.toLowerCase()
  ) {
    throw new Error(
      "live RPC canonical EVM genesis anchor block 1 does not match the deployment manifest",
    );
  }

  await Promise.all(
    CONTRACTS.map((name) =>
      assertDeploymentTransaction({ name, manifest, artifacts, rpcUrl, rpc }),
    ),
  );

  for (const name of CONTRACTS) {
    const code = await rpc({
      rpcUrl,
      method: "eth_getCode",
      params: [addresses[name], "latest"],
    });
    if (EMPTY_CODE.test(String(code))) {
      throw new Error(`${name} release address has no runtime bytecode`);
    }
    if (
      sha256Hex(code) !== manifest.contracts[name].hashes.runtimeBytecodeSha256
    ) {
      throw new Error(
        `${name} live runtime bytecode does not match the deployment manifest`,
      );
    }
  }

  const wiring = manifest.configurationTransactions.setStAethel;
  const [wiringTransaction, wiringReceipt, vaultTokenWord, tokenVaultWord] =
    await Promise.all([
      rpc({
        rpcUrl,
        method: "eth_getTransactionByHash",
        params: [wiring.txHash],
      }),
      rpc({
        rpcUrl,
        method: "eth_getTransactionReceipt",
        params: [wiring.txHash],
      }),
      rpc({
        rpcUrl,
        method: "eth_call",
        params: [
          { to: addresses.Cruzible, data: ST_AETHEL_SELECTOR },
          "latest",
        ],
      }),
      rpc({
        rpcUrl,
        method: "eth_call",
        params: [{ to: addresses.StAETHEL, data: VAULT_SELECTOR }, "latest"],
      }),
    ]);
  const expectedWiringInput = `${SET_ST_AETHEL_SELECTOR}${"0".repeat(24)}${addresses.StAETHEL.slice(2)}`;
  if (
    String(wiringTransaction?.input ?? "").toLowerCase() !== expectedWiringInput
  ) {
    throw new Error(
      "setStAethel transaction calldata does not bind the released token",
    );
  }
  if (
    normalizeAddress(
      wiringTransaction?.to,
      "setStAethel transaction target",
    ) !== addresses.Cruzible ||
    String(wiringReceipt?.status).toLowerCase() !== "0x1" ||
    !sameBlockNumber(wiringReceipt?.blockNumber, wiring.blockNumber)
  ) {
    throw new Error(
      "setStAethel transaction evidence does not match the manifest",
    );
  }
  if (
    decodeAddressWord(vaultTokenWord, "Cruzible.stAethel") !==
    addresses.StAETHEL
  ) {
    throw new Error(
      "live Cruzible vault is not wired to the released StAETHEL token",
    );
  }
  if (
    decodeAddressWord(tokenVaultWord, "StAETHEL.vault") !== addresses.Cruzible
  ) {
    throw new Error(
      "live StAETHEL token is not bound to the released Cruzible vault",
    );
  }

  return { contracts: CONTRACTS, chainId };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function releaseNetwork() {
  const environment = requiredEnv("NEXT_PUBLIC_CHAIN_ENV");
  if (environment === "mainnet") {
    return {
      environment,
      chainId: Number(requiredEnv("NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID")),
      rpcUrl: requiredEnv("NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL"),
    };
  }
  if (environment === "testnet") {
    return {
      environment,
      chainId: 7332,
      rpcUrl: requiredEnv("NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL"),
    };
  }
  if (environment === "devnet") {
    return {
      environment,
      chainId: 7332,
      rpcUrl: requiredEnv("NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL"),
    };
  }
  throw new Error("NEXT_PUBLIC_CHAIN_ENV must be mainnet, testnet, or devnet");
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliEntrypoint) {
  try {
    const network = releaseNetwork();
    const manifest = JSON.parse(
      requiredEnv("RELEASE_EVM_DEPLOYMENT_MANIFEST_JSON"),
    );
    const result = await validateReleaseEvmDeployment({
      manifest,
      ...network,
      cruzibleAddress: requiredEnv("NEXT_PUBLIC_CRUZIBLE_ADDRESS"),
      stAethelAddress: requiredEnv("NEXT_PUBLIC_STAETHEL_ADDRESS"),
      expectedGenesisHash: requiredEnv("NEXT_PUBLIC_AETHELRED_GENESIS_HASH"),
    });
    console.log(
      `Release EVM deployment is live and bound to current artifacts (${result.contracts.join(", ")}; chain ${result.chainId}).`,
    );
  } catch (error) {
    console.error(`Release EVM deployment validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
