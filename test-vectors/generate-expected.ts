/**
 * generate-expected.ts
 *
 * Computes and writes expected hash values for all edge-case test vectors.
 * This is the canonical hash generator — run it once with the TypeScript SDK
 * to populate the expected fields, then all language SDKs validate against them.
 *
 * Usage:
 *   cd sdk/typescript && npx tsc -p tsconfig.json
 *   cd ../../test-vectors && npx ts-node generate-expected.ts
 *
 * Or after building the SDK:
 *   node ../sdk/typescript/dist/test-vectors/generate-expected.js
 *
 * Note: This script must be run from the test-vectors/ directory, or adjust
 * the import path for the SDK.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  computeValidatorSetHash,
  computeSelectionPolicyHash,
  computeEligibleUniverseHash,
  computeStakeSnapshotHash,
  computeStakerRegistryRoot,
  computeDelegationRegistryRoot,
  computeCanonicalValidatorPayload,
} from "../sdk/typescript/src";
import { bytesToHex } from "../sdk/typescript/src/utils";

const VECTORS_DIR = path.resolve(__dirname);
const EDGE_DIR = path.join(VECTORS_DIR, "edge-cases");

function readVector(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeVector(filePath: string, data: any): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  console.log(`  wrote: ${path.relative(VECTORS_DIR, filePath)}`);
}

// ── single-validator.json ──────────────────────────────────────────────────
function generateSingleValidator(): void {
  const filePath = path.join(EDGE_DIR, "single-validator.json");
  const vector = readVector(filePath);
  const { epoch, validators, config, eligible_addresses } = vector.input;

  vector.expected = {
    validator_set_hash: bytesToHex(computeValidatorSetHash(epoch, validators)),
    policy_hash: bytesToHex(computeSelectionPolicyHash(config)),
    universe_hash: bytesToHex(computeEligibleUniverseHash(eligible_addresses)),
    payload_hex: bytesToHex(
      computeCanonicalValidatorPayload(epoch, validators, config, eligible_addresses)
    ),
  };

  writeVector(filePath, vector);
}

// ── zero-stake.json ────────────────────────────────────────────────────────
function generateZeroStake(): void {
  const filePath = path.join(EDGE_DIR, "zero-stake.json");
  const vector = readVector(filePath);
  const { epoch, staker_stakes } = vector.input;

  vector.expected = {
    stake_snapshot_hash: bytesToHex(computeStakeSnapshotHash(epoch, staker_stakes)),
    staker_registry_root: bytesToHex(computeStakerRegistryRoot(staker_stakes)),
    delegation_registry_root: bytesToHex(computeDelegationRegistryRoot(staker_stakes)),
  };

  writeVector(filePath, vector);
}

// ── max-uint64-values.json ─────────────────────────────────────────────────
function generateMaxUint64(): void {
  const filePath = path.join(EDGE_DIR, "max-uint64-values.json");
  const vector = readVector(filePath);
  const { epoch, validators, staker_stakes } = vector.input;

  vector.expected = {
    validator_set_hash: bytesToHex(computeValidatorSetHash(epoch, validators)),
    stake_snapshot_hash: bytesToHex(computeStakeSnapshotHash(epoch, staker_stakes)),
    staker_registry_root: bytesToHex(computeStakerRegistryRoot(staker_stakes)),
    delegation_registry_root: bytesToHex(computeDelegationRegistryRoot(staker_stakes)),
  };

  writeVector(filePath, vector);
}

// ── empty-tee-key.json ─────────────────────────────────────────────────────
function generateEmptyTeeKey(): void {
  const filePath = path.join(EDGE_DIR, "empty-tee-key.json");
  const vector = readVector(filePath);
  const { epoch, validators } = vector.input;

  vector.expected = {
    validator_set_hash: bytesToHex(computeValidatorSetHash(epoch, validators)),
  };

  writeVector(filePath, vector);
}

// ── special-addresses.json ─────────────────────────────────────────────────
function generateSpecialAddresses(): void {
  const filePath = path.join(EDGE_DIR, "special-addresses.json");
  const vector = readVector(filePath);
  const { epoch, staker_stakes, validators } = vector.input;

  vector.expected = {
    validator_set_hash: bytesToHex(computeValidatorSetHash(epoch, validators)),
    stake_snapshot_hash: bytesToHex(computeStakeSnapshotHash(epoch, staker_stakes)),
    staker_registry_root: bytesToHex(computeStakerRegistryRoot(staker_stakes)),
    delegation_registry_root: bytesToHex(computeDelegationRegistryRoot(staker_stakes)),
  };

  writeVector(filePath, vector);
}

// ── max-validators.json ────────────────────────────────────────────────────
function generateMaxValidators(): void {
  const filePath = path.join(EDGE_DIR, "max-validators.json");
  const vector = readVector(filePath);

  // Generate 200 validators deterministically
  const validators: any[] = [];
  for (let i = 0; i < 200; i++) {
    const hex = i.toString(16).padStart(40, "0");
    validators.push({
      address: `0x${hex}`,
      stake: String(32_000_000_000_000_000_000n + BigInt(i) * 1_000_000_000_000_000_000n),
      performance_score: 9000 + (i % 1000),
      decentralization_score: 7000 + (i % 3000),
      reputation_score: 8000 + (i % 2000),
      composite_score: 8000 + (i % 2000),
      tee_public_key: `0x${i.toString(16).padStart(64, "0")}`,
      commission_bps: 100 + (i % 900),
      rank: i + 1,
    });
  }

  vector.input.validators = validators;
  vector.expected = {
    validator_set_hash: bytesToHex(computeValidatorSetHash(vector.input.epoch, validators)),
  };

  writeVector(filePath, vector);
}

// ── Main ───────────────────────────────────────────────────────────────────
console.log("Generating expected hashes for edge-case test vectors...\n");

generateSingleValidator();
generateZeroStake();
generateMaxUint64();
generateEmptyTeeKey();
generateSpecialAddresses();
generateMaxValidators();

console.log("\nDone. All edge-case expected values have been populated.");
