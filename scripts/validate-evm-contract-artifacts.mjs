#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACTS = ["Cruzible", "StAETHEL", "WstAETHEL"];

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }

  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalAbi(value) {
  if (!Array.isArray(value)) return canonicalJson(value);
  return JSON.stringify(
    value
      .map(canonicalize)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
  );
}

function readJson(path, errors, label) {
  if (!existsSync(path)) {
    errors.push(`${label} is missing`);
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

export function validateEvmContractArtifacts(rootDirectory) {
  const repoRoot = resolve(
    rootDirectory ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const contractRoot = join(repoRoot, "backend", "contracts-evm");
  const errors = [];

  for (const contract of CONTRACTS) {
    const compiledPath = join(
      contractRoot,
      "out",
      `${contract}.sol`,
      `${contract}.json`,
    );
    const abiPath = join(contractRoot, "artifacts", `${contract}.abi`);
    const bytecodePath = join(contractRoot, "artifacts", `${contract}.bin`);
    const runtimeBytecodePath = join(
      contractRoot,
      "artifacts",
      `${contract}.bin-runtime`,
    );
    const compiled = readJson(
      compiledPath,
      errors,
      `Foundry output for ${contract}`,
    );
    const committedAbi = readJson(
      abiPath,
      errors,
      `committed ABI for ${contract}`,
    );

    if (!existsSync(bytecodePath)) {
      errors.push(`committed bytecode for ${contract} is missing`);
      continue;
    }
    if (!existsSync(runtimeBytecodePath)) {
      errors.push(`committed runtime bytecode for ${contract} is missing`);
      continue;
    }

    const committedBytecode = readFileSync(bytecodePath, "utf8")
      .trim()
      .replace(/^0x/u, "");
    const compiledBytecode = String(compiled?.bytecode?.object ?? "")
      .trim()
      .replace(/^0x/u, "");
    const committedRuntimeBytecode = readFileSync(runtimeBytecodePath, "utf8")
      .trim()
      .replace(/^0x/u, "");
    const compiledRuntimeBytecode = String(
      compiled?.deployedBytecode?.object ?? "",
    )
      .trim()
      .replace(/^0x/u, "");

    if (!compiledBytecode) {
      errors.push(`Foundry output for ${contract} has no creation bytecode`);
    } else if (committedBytecode !== compiledBytecode) {
      errors.push(
        `committed bytecode for ${contract} does not match the current source; rebuild backend/contracts-evm/artifacts`,
      );
    }

    if (!compiledRuntimeBytecode) {
      errors.push(`Foundry output for ${contract} has no runtime bytecode`);
    } else if (committedRuntimeBytecode !== compiledRuntimeBytecode) {
      errors.push(
        `committed runtime bytecode for ${contract} does not match the current source; rebuild backend/contracts-evm/artifacts`,
      );
    }

    if (
      compiled?.abi &&
      committedAbi &&
      canonicalAbi(compiled.abi) !== canonicalAbi(committedAbi)
    ) {
      errors.push(
        `committed ABI for ${contract} does not match the current source; rebuild backend/contracts-evm/artifacts`,
      );
    }
  }

  return { contracts: CONTRACTS, errors };
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const result = validateEvmContractArtifacts(process.argv[2]);

  if (result.errors.length > 0) {
    console.error("EVM deployment artifact validation failed.");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `EVM deployment artifacts match Foundry output (${result.contracts.join(", ")}).`,
  );
}
