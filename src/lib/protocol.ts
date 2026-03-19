import delegationVector from "../../test-vectors/delegation/default.json";
import rewardVector from "../../test-vectors/reward/default.json";
import validatorVector from "../../test-vectors/validator-selection/default.json";
import {
  bytesToHex,
  computeCanonicalDelegationPayload,
  computeCanonicalRewardPayload,
  computeCanonicalValidatorPayload,
  computeDelegationRegistryRoot,
  computeEligibleUniverseHash,
  computeSelectionPolicyHash,
  computeStakeSnapshotHash,
  computeStakerRegistryRoot,
  computeValidatorSetHash,
} from "../../sdk/typescript/src";

export type ProtocolPreview = {
  validatorSetHash: string;
  policyHash: string;
  universeHash: string;
  stakeSnapshotHash: string;
  stakerRegistryRoot: string;
  delegationRegistryRoot: string;
  validatorPayloadHex: string;
  rewardPayloadHex: string;
  delegationPayloadHex: string;
  vectorMatches: {
    validatorPayload: boolean;
    rewardPayload: boolean;
    delegationPayload: boolean;
    stakerRegistryRoot: boolean;
    delegationRegistryRoot: boolean;
  };
};

export function buildProtocolPreview(): ProtocolPreview {
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
  const validatorPayloadHex = bytesToHex(
    computeCanonicalValidatorPayload(
      validatorVector.input.epoch,
      validatorVector.input.validators,
      validatorVector.input.config,
      validatorVector.input.eligible_addresses,
    ),
  );

  const stakerStakes = rewardVector.input.staker_stakes;
  const stakeSnapshotHash = bytesToHex(
    computeStakeSnapshotHash(rewardVector.input.epoch, stakerStakes),
  );
  const stakerRegistryRoot = bytesToHex(
    computeStakerRegistryRoot(stakerStakes),
  );
  const delegationRegistryRoot = bytesToHex(
    computeDelegationRegistryRoot(stakerStakes),
  );
  const rewardPayloadHex = bytesToHex(
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

  const delegationPayloadHex = bytesToHex(
    computeCanonicalDelegationPayload({
      epoch: delegationVector.input.epoch,
      delegation_root: delegationRegistryRoot,
      staker_registry_root: stakerRegistryRoot,
    }),
  );

  return {
    validatorSetHash,
    policyHash,
    universeHash,
    stakeSnapshotHash,
    stakerRegistryRoot,
    delegationRegistryRoot,
    validatorPayloadHex,
    rewardPayloadHex,
    delegationPayloadHex,
    vectorMatches: {
      validatorPayload:
        validatorPayloadHex === validatorVector.expected.payload_hex,
      rewardPayload: rewardPayloadHex === rewardVector.expected.payload_hex,
      delegationPayload:
        delegationPayloadHex === delegationVector.expected.payload_hex,
      stakerRegistryRoot:
        stakerRegistryRoot === rewardVector.input.staker_registry_root,
      delegationRegistryRoot:
        delegationRegistryRoot === rewardVector.input.delegation_registry_root,
    },
  };
}
