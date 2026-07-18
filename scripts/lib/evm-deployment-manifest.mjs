import { createHash } from "node:crypto";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SCHEMA = "cruzible.evm_deployment_manifest.v2";
const EVM_GENESIS_ANCHOR_BLOCK = 1;

export function sha256Bytes(value) {
  const bytes =
    typeof value === "string" && value.startsWith("0x")
      ? Buffer.from(value.slice(2), "hex")
      : Buffer.from(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function publicRpcOrigin(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("RPC_URL must use http or https");
  }
  return parsed.origin;
}

export function buildEvmDeploymentManifest(input) {
  const manifest = {
    schema: SCHEMA,
    environment: input.environment,
    deployedAt: input.deployedAt,
    source: {
      repository: "https://github.com/aethelred-foundation/cruzible",
      gitCommit: input.sourceCommit,
      clean: input.sourceClean,
    },
    chain: {
      chainId: input.chainId,
      rpcOrigin: publicRpcOrigin(input.rpcUrl),
      genesisBlockNumber: EVM_GENESIS_ANCHOR_BLOCK,
      genesisBlockHash: input.genesisBlockHash,
      evidenceHead: {
        number: String(input.headBlockNumber),
        hash: input.headBlockHash,
      },
    },
    deployer: input.deployer,
    contracts: input.contracts,
    configurationTransactions: input.configurationTransactions,
    roles: input.roles,
    governanceHandover: input.governanceHandover,
    unbondingPeriodSeconds: input.unbondingPeriodSeconds,
    ...(input.identityGate ? { identityGate: input.identityGate } : {}),
  };

  const { errors } = validateEvmDeploymentManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`invalid EVM deployment manifest: ${errors.join("; ")}`);
  }
  return manifest;
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`);
    return "";
  }
  return value;
}

function requirePattern(value, pattern, path, errors) {
  const normalized = requireString(value, path, errors);
  if (normalized && !pattern.test(normalized)) {
    errors.push(`${path} has an invalid format`);
  }
}

function validateTransactionEvidence(transaction, path, errors) {
  requirePattern(transaction?.txHash, HASH_PATTERN, `${path}.txHash`, errors);
  for (const field of ["blockNumber", "gasUsed"]) {
    if (!/^\d+$/u.test(String(transaction?.[field] ?? ""))) {
      errors.push(`${path}.${field} must be an unsigned integer string`);
    }
  }
}

export function validateEvmDeploymentManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { errors: ["$ must be an object"] };
  }
  if (manifest.schema !== SCHEMA) errors.push(`$.schema must be ${SCHEMA}`);
  if (!["devnet", "testnet", "mainnet"].includes(manifest.environment)) {
    errors.push("$.environment must be devnet, testnet, or mainnet");
  }
  requireString(manifest.deployedAt, "$.deployedAt", errors);
  if (
    !Number.isInteger(manifest.chain?.chainId) ||
    manifest.chain.chainId <= 0
  ) {
    errors.push("$.chain.chainId must be a positive integer");
  }
  requireString(manifest.chain?.rpcOrigin, "$.chain.rpcOrigin", errors);
  try {
    const rpc = new URL(manifest.chain?.rpcOrigin);
    if (
      rpc.username ||
      rpc.password ||
      rpc.search ||
      rpc.hash ||
      rpc.pathname !== "/"
    ) {
      errors.push("$.chain.rpcOrigin must be a redacted bare origin");
    }
  } catch {
    errors.push("$.chain.rpcOrigin must be an absolute URL");
  }
  requirePattern(
    manifest.chain?.genesisBlockHash,
    HASH_PATTERN,
    "$.chain.genesisBlockHash",
    errors,
  );
  if (manifest.chain?.genesisBlockNumber !== EVM_GENESIS_ANCHOR_BLOCK) {
    errors.push(
      `$.chain.genesisBlockNumber must be ${EVM_GENESIS_ANCHOR_BLOCK}`,
    );
  }
  requirePattern(
    manifest.chain?.evidenceHead?.hash,
    HASH_PATTERN,
    "$.chain.evidenceHead.hash",
    errors,
  );
  if (!/^\d+$/u.test(String(manifest.chain?.evidenceHead?.number ?? ""))) {
    errors.push(
      "$.chain.evidenceHead.number must be an unsigned integer string",
    );
  }
  requirePattern(
    manifest.source?.gitCommit,
    GIT_SHA_PATTERN,
    "$.source.gitCommit",
    errors,
  );
  if (typeof manifest.source?.clean !== "boolean") {
    errors.push("$.source.clean must be boolean");
  }
  requirePattern(manifest.deployer, ADDRESS_PATTERN, "$.deployer", errors);

  const expectedContracts = ["Cruzible", "StAETHEL"];
  for (const name of expectedContracts) {
    if (!manifest.contracts?.[name]) {
      errors.push(`$.contracts.${name} is required`);
    }
  }
  for (const [name, contract] of Object.entries(manifest.contracts ?? {})) {
    requirePattern(
      contract.address,
      ADDRESS_PATTERN,
      `$.contracts.${name}.address`,
      errors,
    );
    requirePattern(
      contract.deployTxHash,
      HASH_PATTERN,
      `$.contracts.${name}.deployTxHash`,
      errors,
    );
    if (!/^\d+$/u.test(String(contract.blockNumber ?? ""))) {
      errors.push(
        `$.contracts.${name}.blockNumber must be an unsigned integer string`,
      );
    }
    if (!/^\d+$/u.test(String(contract.gasUsed ?? ""))) {
      errors.push(
        `$.contracts.${name}.gasUsed must be an unsigned integer string`,
      );
    }
    for (const [field, value] of Object.entries(contract.hashes ?? {})) {
      requirePattern(
        value,
        SHA256_PATTERN,
        `$.contracts.${name}.hashes.${field}`,
        errors,
      );
    }
    for (const requiredHash of [
      "abiFileSha256",
      "creationBytecodeFileSha256",
      "creationBytecodeSha256",
      "runtimeBytecodeSha256",
    ]) {
      if (!contract.hashes?.[requiredHash]) {
        errors.push(`$.contracts.${name}.hashes.${requiredHash} is required`);
      }
    }
  }

  if (!manifest.configurationTransactions?.setStAethel) {
    errors.push("$.configurationTransactions.setStAethel is required");
  }
  for (const [name, transaction] of Object.entries(
    manifest.configurationTransactions ?? {},
  )) {
    validateTransactionEvidence(
      transaction,
      `$.configurationTransactions.${name}`,
      errors,
    );
  }

  for (const role of ["currentGovernance", "rewarder", "pauser"]) {
    requirePattern(
      manifest.roles?.[role],
      ADDRESS_PATTERN,
      `$.roles.${role}`,
      errors,
    );
  }
  if (manifest.roles?.pendingGovernance !== null) {
    requirePattern(
      manifest.roles?.pendingGovernance,
      ADDRESS_PATTERN,
      "$.roles.pendingGovernance",
      errors,
    );
  }
  if (typeof manifest.governanceHandover?.accepted !== "boolean") {
    errors.push("$.governanceHandover.accepted must be boolean");
  }
  if (manifest.governanceHandover?.requested) {
    requirePattern(
      manifest.governanceHandover?.transferTxHash,
      HASH_PATTERN,
      "$.governanceHandover.transferTxHash",
      errors,
    );
  }
  if (
    manifest.governanceHandover?.accepted &&
    manifest.roles?.pendingGovernance
  ) {
    errors.push(
      "accepted governance handover must not retain pendingGovernance",
    );
  }
  if (
    !Number.isSafeInteger(manifest.unbondingPeriodSeconds) ||
    manifest.unbondingPeriodSeconds < 0
  ) {
    errors.push("$.unbondingPeriodSeconds must be a non-negative safe integer");
  }
  if (manifest.identityGate) {
    requirePattern(
      manifest.identityGate.registry,
      ADDRESS_PATTERN,
      "$.identityGate.registry",
      errors,
    );
    requirePattern(
      manifest.identityGate.configurationTxHash,
      HASH_PATTERN,
      "$.identityGate.configurationTxHash",
      errors,
    );
    if (manifest.identityGate.required !== true) {
      errors.push(
        "$.identityGate.required must be true when identityGate is present",
      );
    }
  }
  return { errors };
}
