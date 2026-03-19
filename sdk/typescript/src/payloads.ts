import type {
  DelegationPayloadInput,
  RewardPayloadInput,
  ScoredValidator,
  SelectionConfig,
  StakerStake,
} from "./types";
import {
  concatBytes,
  encodeFloat64BE,
  encodeU64Word,
  encodeUint256,
  padAddressish32,
  padBytes32,
  parseAddressBytes20,
  sha256Bytes,
  teePublicKeyBytes32,
  utf8Bytes,
  xorBytes32,
} from "./utils";
import { keccak256 } from "./keccak";

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function computeValidatorSetHash(
  epoch: bigint | number | string,
  validators: readonly ScoredValidator[],
): Uint8Array {
  const innerHashes = validators.map((validator) => {
    const inner = concatBytes(
      padAddressish32(validator.address),
      encodeUint256(validator.stake),
      encodeUint256(validator.performance_score),
      encodeUint256(validator.decentralization_score),
      encodeUint256(validator.reputation_score),
      encodeUint256(validator.composite_score),
      teePublicKeyBytes32(validator.tee_public_key),
      encodeUint256(validator.commission_bps),
    );
    return sha256Bytes(inner);
  });

  return sha256Bytes(
    concatBytes(
      utf8Bytes("CruzibleValidatorSet-v1"),
      Uint8Array.from(
        Buffer.from(BigInt(epoch).toString(16).padStart(16, "0"), "hex"),
      ),
      Uint8Array.from(
        Buffer.from(validators.length.toString(16).padStart(8, "0"), "hex"),
      ),
      ...innerHashes,
    ),
  );
}

export function computeSelectionPolicyHash(
  config: SelectionConfig,
): Uint8Array {
  return sha256Bytes(
    concatBytes(
      utf8Bytes("CruzibleSelectionPolicy-v1"),
      encodeFloat64BE(config.performance_weight),
      encodeFloat64BE(config.decentralization_weight),
      encodeFloat64BE(config.reputation_weight),
      encodeFloat64BE(config.min_uptime_pct),
      encodeUint256(config.max_commission_bps),
      encodeUint256(config.max_per_region),
      encodeUint256(config.max_per_operator),
      encodeUint256(config.min_stake),
    ),
  );
}

export function computeEligibleUniverseHash(
  addresses: readonly string[],
): Uint8Array {
  const parts = sortStrings(addresses).flatMap((address) => [
    utf8Bytes(address),
    new Uint8Array([0]),
  ]);
  return sha256Bytes(concatBytes(...parts));
}

export function computeStakeSnapshotHash(
  epoch: bigint | number | string,
  stakers: readonly StakerStake[],
): Uint8Array {
  const sorted = [...stakers].sort((a, b) =>
    a.address.localeCompare(b.address),
  );
  const innerHashes = sorted.map((staker) =>
    sha256Bytes(
      concatBytes(
        padAddressish32(staker.address),
        encodeUint256(staker.shares),
        padAddressish32(staker.delegated_to),
      ),
    ),
  );

  return sha256Bytes(
    concatBytes(
      utf8Bytes("CruzibleStakeSnapshot-v1"),
      Uint8Array.from(
        Buffer.from(BigInt(epoch).toString(16).padStart(16, "0"), "hex"),
      ),
      Uint8Array.from(
        Buffer.from(sorted.length.toString(16).padStart(8, "0"), "hex"),
      ),
      ...innerHashes,
    ),
  );
}

export function validateUniqueStakerAddresses(
  stakers: readonly StakerStake[],
): void {
  const seen = new Set<string>();
  for (const staker of stakers) {
    if (seen.has(staker.address)) {
      throw new Error(`duplicate staker address: ${staker.address}`);
    }
    seen.add(staker.address);
  }
}

export function computeStakerRegistryRoot(
  stakers: readonly StakerStake[],
): Uint8Array {
  validateUniqueStakerAddresses(stakers);
  const accumulator = new Uint8Array(32);

  for (const staker of stakers) {
    if (BigInt(staker.shares) === 0n) {
      continue;
    }
    const leaf = concatBytes(
      parseAddressBytes20(staker.address),
      encodeUint256(staker.shares),
    );
    xorBytes32(accumulator, keccak256(leaf));
  }

  return accumulator;
}

export function computeDelegationRegistryRoot(
  stakers: readonly StakerStake[],
): Uint8Array {
  validateUniqueStakerAddresses(stakers);
  const accumulator = new Uint8Array(32);

  for (const staker of stakers) {
    if (BigInt(staker.shares) === 0n) {
      continue;
    }
    const leaf = concatBytes(
      parseAddressBytes20(staker.address),
      parseAddressBytes20(staker.delegated_to),
    );
    xorBytes32(accumulator, keccak256(leaf));
  }

  return accumulator;
}

export function computeCanonicalValidatorPayload(
  epoch: bigint | number | string,
  validators: readonly ScoredValidator[],
  config: SelectionConfig,
  eligibleAddresses: readonly string[],
): Uint8Array {
  return concatBytes(
    computeValidatorSetHash(epoch, validators),
    computeSelectionPolicyHash(config),
    computeEligibleUniverseHash(eligibleAddresses),
  );
}

export function computeCanonicalRewardPayload(
  input: RewardPayloadInput,
): Uint8Array {
  return concatBytes(
    encodeU64Word(input.epoch),
    encodeUint256(input.total_rewards),
    padBytes32(input.merkle_root),
    encodeUint256(input.protocol_fee),
    padBytes32(input.stake_snapshot_hash),
    padBytes32(input.validator_set_hash),
    padBytes32(input.staker_registry_root),
    padBytes32(input.delegation_registry_root),
  );
}

export function computeCanonicalDelegationPayload(
  input: DelegationPayloadInput,
): Uint8Array {
  return concatBytes(
    encodeU64Word(input.epoch),
    padBytes32(input.delegation_root),
    padBytes32(input.staker_registry_root),
  );
}
