"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeValidatorSetHash = computeValidatorSetHash;
exports.computeSelectionPolicyHash = computeSelectionPolicyHash;
exports.computeEligibleUniverseHash = computeEligibleUniverseHash;
exports.computeStakeSnapshotHash = computeStakeSnapshotHash;
exports.validateUniqueStakerAddresses = validateUniqueStakerAddresses;
exports.computeStakerRegistryRoot = computeStakerRegistryRoot;
exports.computeDelegationRegistryRoot = computeDelegationRegistryRoot;
exports.computeCanonicalValidatorPayload = computeCanonicalValidatorPayload;
exports.computeCanonicalRewardPayload = computeCanonicalRewardPayload;
exports.computeCanonicalDelegationPayload = computeCanonicalDelegationPayload;
const utils_1 = require("./utils");
const keccak_1 = require("./keccak");
function sortStrings(values) {
    return [...values].sort((a, b) => a.localeCompare(b));
}
function computeValidatorSetHash(epoch, validators) {
    const innerHashes = validators.map((validator) => {
        const inner = (0, utils_1.concatBytes)((0, utils_1.padAddressish32)(validator.address), (0, utils_1.encodeUint256)(validator.stake), (0, utils_1.encodeUint256)(validator.performance_score), (0, utils_1.encodeUint256)(validator.decentralization_score), (0, utils_1.encodeUint256)(validator.reputation_score), (0, utils_1.encodeUint256)(validator.composite_score), (0, utils_1.teePublicKeyBytes32)(validator.tee_public_key), (0, utils_1.encodeUint256)(validator.commission_bps));
        return (0, utils_1.sha256Bytes)(inner);
    });
    return (0, utils_1.sha256Bytes)((0, utils_1.concatBytes)((0, utils_1.utf8Bytes)("CruzibleValidatorSet-v1"), Uint8Array.from(Buffer.from(BigInt(epoch).toString(16).padStart(16, "0"), "hex")), Uint8Array.from(Buffer.from(validators.length.toString(16).padStart(8, "0"), "hex")), ...innerHashes));
}
function computeSelectionPolicyHash(config) {
    return (0, utils_1.sha256Bytes)((0, utils_1.concatBytes)((0, utils_1.utf8Bytes)("CruzibleSelectionPolicy-v1"), (0, utils_1.encodeFloat64BE)(config.performance_weight), (0, utils_1.encodeFloat64BE)(config.decentralization_weight), (0, utils_1.encodeFloat64BE)(config.reputation_weight), (0, utils_1.encodeFloat64BE)(config.min_uptime_pct), (0, utils_1.encodeUint256)(config.max_commission_bps), (0, utils_1.encodeUint256)(config.max_per_region), (0, utils_1.encodeUint256)(config.max_per_operator), (0, utils_1.encodeUint256)(config.min_stake)));
}
function computeEligibleUniverseHash(addresses) {
    const parts = sortStrings(addresses).flatMap((address) => [(0, utils_1.utf8Bytes)(address), new Uint8Array([0])]);
    return (0, utils_1.sha256Bytes)((0, utils_1.concatBytes)(...parts));
}
function computeStakeSnapshotHash(epoch, stakers) {
    const sorted = [...stakers].sort((a, b) => a.address.localeCompare(b.address));
    const innerHashes = sorted.map((staker) => (0, utils_1.sha256Bytes)((0, utils_1.concatBytes)((0, utils_1.padAddressish32)(staker.address), (0, utils_1.encodeUint256)(staker.shares), (0, utils_1.padAddressish32)(staker.delegated_to))));
    return (0, utils_1.sha256Bytes)((0, utils_1.concatBytes)((0, utils_1.utf8Bytes)("CruzibleStakeSnapshot-v1"), Uint8Array.from(Buffer.from(BigInt(epoch).toString(16).padStart(16, "0"), "hex")), Uint8Array.from(Buffer.from(sorted.length.toString(16).padStart(8, "0"), "hex")), ...innerHashes));
}
function validateUniqueStakerAddresses(stakers) {
    const seen = new Set();
    for (const staker of stakers) {
        if (seen.has(staker.address)) {
            throw new Error(`duplicate staker address: ${staker.address}`);
        }
        seen.add(staker.address);
    }
}
function computeStakerRegistryRoot(stakers) {
    validateUniqueStakerAddresses(stakers);
    const accumulator = new Uint8Array(32);
    for (const staker of stakers) {
        if (BigInt(staker.shares) === 0n) {
            continue;
        }
        const leaf = (0, utils_1.concatBytes)((0, utils_1.parseAddressBytes20)(staker.address), (0, utils_1.encodeUint256)(staker.shares));
        (0, utils_1.xorBytes32)(accumulator, (0, keccak_1.keccak256)(leaf));
    }
    return accumulator;
}
function computeDelegationRegistryRoot(stakers) {
    validateUniqueStakerAddresses(stakers);
    const accumulator = new Uint8Array(32);
    for (const staker of stakers) {
        if (BigInt(staker.shares) === 0n) {
            continue;
        }
        const leaf = (0, utils_1.concatBytes)((0, utils_1.parseAddressBytes20)(staker.address), (0, utils_1.parseAddressBytes20)(staker.delegated_to));
        (0, utils_1.xorBytes32)(accumulator, (0, keccak_1.keccak256)(leaf));
    }
    return accumulator;
}
function computeCanonicalValidatorPayload(epoch, validators, config, eligibleAddresses) {
    return (0, utils_1.concatBytes)(computeValidatorSetHash(epoch, validators), computeSelectionPolicyHash(config), computeEligibleUniverseHash(eligibleAddresses));
}
function computeCanonicalRewardPayload(input) {
    return (0, utils_1.concatBytes)((0, utils_1.encodeU64Word)(input.epoch), (0, utils_1.encodeUint256)(input.total_rewards), (0, utils_1.padBytes32)(input.merkle_root), (0, utils_1.encodeUint256)(input.protocol_fee), (0, utils_1.padBytes32)(input.stake_snapshot_hash), (0, utils_1.padBytes32)(input.validator_set_hash), (0, utils_1.padBytes32)(input.staker_registry_root), (0, utils_1.padBytes32)(input.delegation_registry_root));
}
function computeCanonicalDelegationPayload(input) {
    return (0, utils_1.concatBytes)((0, utils_1.encodeU64Word)(input.epoch), (0, utils_1.padBytes32)(input.delegation_root), (0, utils_1.padBytes32)(input.staker_registry_root));
}
