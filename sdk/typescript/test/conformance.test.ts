import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  computeCanonicalDelegationPayload,
  computeCanonicalRewardPayload,
  computeCanonicalValidatorPayload,
  computeDelegationRegistryRoot,
  computeEligibleUniverseHash,
  computeSelectionPolicyHash,
  computeStakeSnapshotHash,
  computeStakerRegistryRoot,
  computeValidatorSetHash,
} from "../src";
import { bytesToHex } from "../src/utils";

const VECTORS_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function readJson(relativePath: string): any {
  const fullPath = path.resolve(VECTORS_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function tryReadJson(relativePath: string): any | null {
  const fullPath = path.resolve(VECTORS_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

// ─── Default Vectors ──────────────────────────────────────────────────────
function testDefaultVectors(): void {
  console.log("  [default] validator-selection/default.json");
  const validatorVector = readJson(
    "test-vectors/validator-selection/default.json",
  );
  const rewardVector = readJson("test-vectors/reward/default.json");
  const delegationVector = readJson("test-vectors/delegation/default.json");

  const validatorSetHash = bytesToHex(
    computeValidatorSetHash(
      validatorVector.input.epoch,
      validatorVector.input.validators,
    ),
  );
  const policyHash = bytesToHex(
    computeSelectionPolicyHash(validatorVector.input.config),
  );
  const universeHash = bytesToHex(
    computeEligibleUniverseHash(validatorVector.input.eligible_addresses),
  );
  const validatorPayload = bytesToHex(
    computeCanonicalValidatorPayload(
      validatorVector.input.epoch,
      validatorVector.input.validators,
      validatorVector.input.config,
      validatorVector.input.eligible_addresses,
    ),
  );

  assert.equal(validatorSetHash, validatorVector.expected.validator_set_hash);
  assert.equal(policyHash, validatorVector.expected.policy_hash);
  assert.equal(universeHash, validatorVector.expected.universe_hash);
  assert.equal(validatorPayload, validatorVector.expected.payload_hex);

  console.log("  [default] reward/default.json");
  const stakeSnapshotHash = bytesToHex(
    computeStakeSnapshotHash(
      rewardVector.input.epoch,
      rewardVector.input.staker_stakes,
    ),
  );
  const stakerRegistryRoot = bytesToHex(
    computeStakerRegistryRoot(rewardVector.input.staker_stakes),
  );
  const delegationRegistryRoot = bytesToHex(
    computeDelegationRegistryRoot(rewardVector.input.staker_stakes),
  );
  const rewardPayload = bytesToHex(
    computeCanonicalRewardPayload({
      epoch: rewardVector.input.epoch,
      total_rewards: rewardVector.input.total_rewards,
      merkle_root: rewardVector.input.merkle_root,
      protocol_fee: rewardVector.input.protocol_fee,
      stake_snapshot_hash: stakeSnapshotHash,
      validator_set_hash: rewardVector.input.validator_set_hash,
      staker_registry_root: stakerRegistryRoot,
      delegation_registry_root: delegationRegistryRoot,
    }),
  );

  assert.equal(stakeSnapshotHash, rewardVector.expected.stake_snapshot_hash);
  assert.equal(stakerRegistryRoot, rewardVector.expected.staker_registry_root);
  assert.equal(
    delegationRegistryRoot,
    rewardVector.expected.delegation_registry_root,
  );
  assert.equal(rewardPayload, rewardVector.expected.payload_hex);

  console.log("  [default] delegation/default.json");
  const delegationPayload = bytesToHex(
    computeCanonicalDelegationPayload(delegationVector.input),
  );
  assert.equal(delegationPayload, delegationVector.expected.payload_hex);
}

// ─── Edge Case Vectors ────────────────────────────────────────────────────

function hasExpectedValues(expected: any): boolean {
  if (!expected) return false;
  return Object.entries(expected).some(
    ([key, value]) =>
      key !== "_note" && value !== null && typeof value === "string",
  );
}

function testEdgeSingleValidator(): void {
  const vector = tryReadJson("test-vectors/edge-cases/single-validator.json");
  if (!vector || !hasExpectedValues(vector.expected)) {
    console.log(
      "  [skip] single-validator.json (expected values not yet generated)",
    );
    return;
  }
  console.log("  [edge] single-validator.json");
  const { epoch, validators, config, eligible_addresses } = vector.input;
  assert.equal(
    bytesToHex(computeValidatorSetHash(epoch, validators)),
    vector.expected.validator_set_hash,
  );
  assert.equal(
    bytesToHex(computeSelectionPolicyHash(config)),
    vector.expected.policy_hash,
  );
  assert.equal(
    bytesToHex(computeEligibleUniverseHash(eligible_addresses)),
    vector.expected.universe_hash,
  );
  assert.equal(
    bytesToHex(
      computeCanonicalValidatorPayload(
        epoch,
        validators,
        config,
        eligible_addresses,
      ),
    ),
    vector.expected.payload_hex,
  );
}

function testEdgeZeroStake(): void {
  const vector = tryReadJson("test-vectors/edge-cases/zero-stake.json");
  if (!vector || !hasExpectedValues(vector.expected)) {
    console.log("  [skip] zero-stake.json (expected values not yet generated)");
    return;
  }
  console.log("  [edge] zero-stake.json");
  const { epoch, staker_stakes } = vector.input;
  assert.equal(
    bytesToHex(computeStakeSnapshotHash(epoch, staker_stakes)),
    vector.expected.stake_snapshot_hash,
  );
  assert.equal(
    bytesToHex(computeStakerRegistryRoot(staker_stakes)),
    vector.expected.staker_registry_root,
  );
  assert.equal(
    bytesToHex(computeDelegationRegistryRoot(staker_stakes)),
    vector.expected.delegation_registry_root,
  );
}

function testEdgeMaxUint64(): void {
  const vector = tryReadJson("test-vectors/edge-cases/max-uint64-values.json");
  if (!vector || !hasExpectedValues(vector.expected)) {
    console.log(
      "  [skip] max-uint64-values.json (expected values not yet generated)",
    );
    return;
  }
  console.log("  [edge] max-uint64-values.json");
  const { epoch, validators, staker_stakes } = vector.input;
  assert.equal(
    bytesToHex(computeValidatorSetHash(epoch, validators)),
    vector.expected.validator_set_hash,
  );
  assert.equal(
    bytesToHex(computeStakeSnapshotHash(epoch, staker_stakes)),
    vector.expected.stake_snapshot_hash,
  );
  assert.equal(
    bytesToHex(computeStakerRegistryRoot(staker_stakes)),
    vector.expected.staker_registry_root,
  );
  assert.equal(
    bytesToHex(computeDelegationRegistryRoot(staker_stakes)),
    vector.expected.delegation_registry_root,
  );
}

function testEdgeEmptyTeeKey(): void {
  const vector = tryReadJson("test-vectors/edge-cases/empty-tee-key.json");
  if (!vector || !hasExpectedValues(vector.expected)) {
    console.log(
      "  [skip] empty-tee-key.json (expected values not yet generated)",
    );
    return;
  }
  console.log("  [edge] empty-tee-key.json");
  const { epoch, validators } = vector.input;
  assert.equal(
    bytesToHex(computeValidatorSetHash(epoch, validators)),
    vector.expected.validator_set_hash,
  );
}

function testEdgeSpecialAddresses(): void {
  const vector = tryReadJson("test-vectors/edge-cases/special-addresses.json");
  if (!vector || !hasExpectedValues(vector.expected)) {
    console.log(
      "  [skip] special-addresses.json (expected values not yet generated)",
    );
    return;
  }
  console.log("  [edge] special-addresses.json");
  const { epoch, staker_stakes, validators } = vector.input;
  assert.equal(
    bytesToHex(computeValidatorSetHash(epoch, validators)),
    vector.expected.validator_set_hash,
  );
  assert.equal(
    bytesToHex(computeStakeSnapshotHash(epoch, staker_stakes)),
    vector.expected.stake_snapshot_hash,
  );
  assert.equal(
    bytesToHex(computeStakerRegistryRoot(staker_stakes)),
    vector.expected.staker_registry_root,
  );
  assert.equal(
    bytesToHex(computeDelegationRegistryRoot(staker_stakes)),
    vector.expected.delegation_registry_root,
  );
}

function testEdgeMaxValidators(): void {
  const vector = tryReadJson("test-vectors/edge-cases/max-validators.json");
  if (!vector || !hasExpectedValues(vector.expected)) {
    console.log(
      "  [skip] max-validators.json (expected values not yet generated)",
    );
    return;
  }
  if (!Array.isArray(vector.input.validators)) {
    console.log("  [skip] max-validators.json (validators not yet generated)");
    return;
  }
  console.log("  [edge] max-validators.json");
  assert.equal(
    bytesToHex(
      computeValidatorSetHash(vector.input.epoch, vector.input.validators),
    ),
    vector.expected.validator_set_hash,
  );
}

// ─── Runner ───────────────────────────────────────────────────────────────

function main(): void {
  let passed = 0;
  let failed = 0;

  const tests = [
    { name: "default-vectors", fn: testDefaultVectors },
    { name: "edge/single-validator", fn: testEdgeSingleValidator },
    { name: "edge/zero-stake", fn: testEdgeZeroStake },
    { name: "edge/max-uint64-values", fn: testEdgeMaxUint64 },
    { name: "edge/empty-tee-key", fn: testEdgeEmptyTeeKey },
    { name: "edge/special-addresses", fn: testEdgeSpecialAddresses },
    { name: "edge/max-validators", fn: testEdgeMaxValidators },
  ];

  for (const test of tests) {
    try {
      test.fn();
      passed++;
      console.log(`  PASS: ${test.name}`);
    } catch (err: any) {
      failed++;
      console.error(`  FAIL: ${test.name} — ${err.message}`);
    }
  }

  console.log(`\nTypeScript conformance: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
