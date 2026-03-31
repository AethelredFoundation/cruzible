"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const src_1 = require("../src");
const utils_1 = require("../src/utils");
const VECTORS_ROOT = node_path_1.default.resolve(__dirname, "..", "..", "..", "..");
function readJson(relativePath) {
    const fullPath = node_path_1.default.resolve(VECTORS_ROOT, relativePath);
    return JSON.parse(node_fs_1.default.readFileSync(fullPath, "utf8"));
}
function tryReadJson(relativePath) {
    const fullPath = node_path_1.default.resolve(VECTORS_ROOT, relativePath);
    if (!node_fs_1.default.existsSync(fullPath)) {
        return null;
    }
    return JSON.parse(node_fs_1.default.readFileSync(fullPath, "utf8"));
}
// ─── Default Vectors ──────────────────────────────────────────────────────
function testDefaultVectors() {
    console.log("  [default] validator-selection/default.json");
    const validatorVector = readJson("test-vectors/validator-selection/default.json");
    const rewardVector = readJson("test-vectors/reward/default.json");
    const delegationVector = readJson("test-vectors/delegation/default.json");
    const validatorSetHash = (0, utils_1.bytesToHex)((0, src_1.computeValidatorSetHash)(validatorVector.input.epoch, validatorVector.input.validators));
    const policyHash = (0, utils_1.bytesToHex)((0, src_1.computeSelectionPolicyHash)(validatorVector.input.config));
    const universeHash = (0, utils_1.bytesToHex)((0, src_1.computeEligibleUniverseHash)(validatorVector.input.eligible_addresses));
    const validatorPayload = (0, utils_1.bytesToHex)((0, src_1.computeCanonicalValidatorPayload)(validatorVector.input.epoch, validatorVector.input.validators, validatorVector.input.config, validatorVector.input.eligible_addresses));
    strict_1.default.equal(validatorSetHash, validatorVector.expected.validator_set_hash);
    strict_1.default.equal(policyHash, validatorVector.expected.policy_hash);
    strict_1.default.equal(universeHash, validatorVector.expected.universe_hash);
    strict_1.default.equal(validatorPayload, validatorVector.expected.payload_hex);
    console.log("  [default] reward/default.json");
    const stakeSnapshotHash = (0, utils_1.bytesToHex)((0, src_1.computeStakeSnapshotHash)(rewardVector.input.epoch, rewardVector.input.staker_stakes));
    const stakerRegistryRoot = (0, utils_1.bytesToHex)((0, src_1.computeStakerRegistryRoot)(rewardVector.input.staker_stakes));
    const delegationRegistryRoot = (0, utils_1.bytesToHex)((0, src_1.computeDelegationRegistryRoot)(rewardVector.input.staker_stakes));
    const rewardPayload = (0, utils_1.bytesToHex)((0, src_1.computeCanonicalRewardPayload)({
        epoch: rewardVector.input.epoch,
        total_rewards: rewardVector.input.total_rewards,
        merkle_root: rewardVector.input.merkle_root,
        protocol_fee: rewardVector.input.protocol_fee,
        stake_snapshot_hash: stakeSnapshotHash,
        validator_set_hash: rewardVector.input.validator_set_hash,
        staker_registry_root: stakerRegistryRoot,
        delegation_registry_root: delegationRegistryRoot,
    }));
    strict_1.default.equal(stakeSnapshotHash, rewardVector.expected.stake_snapshot_hash);
    strict_1.default.equal(stakerRegistryRoot, rewardVector.expected.staker_registry_root);
    strict_1.default.equal(delegationRegistryRoot, rewardVector.expected.delegation_registry_root);
    strict_1.default.equal(rewardPayload, rewardVector.expected.payload_hex);
    console.log("  [default] delegation/default.json");
    const delegationPayload = (0, utils_1.bytesToHex)((0, src_1.computeCanonicalDelegationPayload)(delegationVector.input));
    strict_1.default.equal(delegationPayload, delegationVector.expected.payload_hex);
}
// ─── Edge Case Vectors ────────────────────────────────────────────────────
function hasExpectedValues(expected) {
    if (!expected)
        return false;
    return Object.entries(expected).some(([key, value]) => key !== "_note" && value !== null && typeof value === "string");
}
function testEdgeSingleValidator() {
    const vector = tryReadJson("test-vectors/edge-cases/single-validator.json");
    if (!vector || !hasExpectedValues(vector.expected)) {
        console.log("  [skip] single-validator.json (expected values not yet generated)");
        return;
    }
    console.log("  [edge] single-validator.json");
    const { epoch, validators, config, eligible_addresses } = vector.input;
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeValidatorSetHash)(epoch, validators)), vector.expected.validator_set_hash);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeSelectionPolicyHash)(config)), vector.expected.policy_hash);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeEligibleUniverseHash)(eligible_addresses)), vector.expected.universe_hash);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeCanonicalValidatorPayload)(epoch, validators, config, eligible_addresses)), vector.expected.payload_hex);
}
function testEdgeZeroStake() {
    const vector = tryReadJson("test-vectors/edge-cases/zero-stake.json");
    if (!vector || !hasExpectedValues(vector.expected)) {
        console.log("  [skip] zero-stake.json (expected values not yet generated)");
        return;
    }
    console.log("  [edge] zero-stake.json");
    const { epoch, staker_stakes } = vector.input;
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeStakeSnapshotHash)(epoch, staker_stakes)), vector.expected.stake_snapshot_hash);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeStakerRegistryRoot)(staker_stakes)), vector.expected.staker_registry_root);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeDelegationRegistryRoot)(staker_stakes)), vector.expected.delegation_registry_root);
}
function testEdgeMaxUint64() {
    const vector = tryReadJson("test-vectors/edge-cases/max-uint64-values.json");
    if (!vector || !hasExpectedValues(vector.expected)) {
        console.log("  [skip] max-uint64-values.json (expected values not yet generated)");
        return;
    }
    console.log("  [edge] max-uint64-values.json");
    const { epoch, validators, staker_stakes } = vector.input;
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeValidatorSetHash)(epoch, validators)), vector.expected.validator_set_hash);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeStakeSnapshotHash)(epoch, staker_stakes)), vector.expected.stake_snapshot_hash);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeStakerRegistryRoot)(staker_stakes)), vector.expected.staker_registry_root);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeDelegationRegistryRoot)(staker_stakes)), vector.expected.delegation_registry_root);
}
function testEdgeEmptyTeeKey() {
    const vector = tryReadJson("test-vectors/edge-cases/empty-tee-key.json");
    if (!vector || !hasExpectedValues(vector.expected)) {
        console.log("  [skip] empty-tee-key.json (expected values not yet generated)");
        return;
    }
    console.log("  [edge] empty-tee-key.json");
    const { epoch, validators } = vector.input;
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeValidatorSetHash)(epoch, validators)), vector.expected.validator_set_hash);
}
function testEdgeSpecialAddresses() {
    const vector = tryReadJson("test-vectors/edge-cases/special-addresses.json");
    if (!vector || !hasExpectedValues(vector.expected)) {
        console.log("  [skip] special-addresses.json (expected values not yet generated)");
        return;
    }
    console.log("  [edge] special-addresses.json");
    const { epoch, staker_stakes, validators } = vector.input;
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeValidatorSetHash)(epoch, validators)), vector.expected.validator_set_hash);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeStakeSnapshotHash)(epoch, staker_stakes)), vector.expected.stake_snapshot_hash);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeStakerRegistryRoot)(staker_stakes)), vector.expected.staker_registry_root);
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeDelegationRegistryRoot)(staker_stakes)), vector.expected.delegation_registry_root);
}
function testEdgeMaxValidators() {
    const vector = tryReadJson("test-vectors/edge-cases/max-validators.json");
    if (!vector || !hasExpectedValues(vector.expected)) {
        console.log("  [skip] max-validators.json (expected values not yet generated)");
        return;
    }
    if (!Array.isArray(vector.input.validators)) {
        console.log("  [skip] max-validators.json (validators not yet generated)");
        return;
    }
    console.log("  [edge] max-validators.json");
    strict_1.default.equal((0, utils_1.bytesToHex)((0, src_1.computeValidatorSetHash)(vector.input.epoch, vector.input.validators)), vector.expected.validator_set_hash);
}
// ─── Runner ───────────────────────────────────────────────────────────────
function main() {
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
        }
        catch (err) {
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
