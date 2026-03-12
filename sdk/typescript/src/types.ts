export type IntegerLike = bigint | number | string;

export interface ScoredValidator {
  address: string;
  stake: IntegerLike;
  performance_score: number;
  decentralization_score: number;
  reputation_score: number;
  composite_score: number;
  tee_public_key: string;
  commission_bps: number;
  rank: number;
}

export interface SelectionConfig {
  performance_weight: number;
  decentralization_weight: number;
  reputation_weight: number;
  min_uptime_pct: number;
  max_commission_bps: number;
  max_per_region: number;
  max_per_operator: number;
  min_stake: IntegerLike;
}

export interface StakerStake {
  address: string;
  shares: IntegerLike;
  delegated_to: string;
}

export interface RewardPayloadInput {
  epoch: IntegerLike;
  total_rewards: IntegerLike;
  merkle_root: string;
  protocol_fee: IntegerLike;
  stake_snapshot_hash: string;
  validator_set_hash: string;
  staker_registry_root: string;
  delegation_registry_root: string;
}

export interface DelegationPayloadInput {
  epoch: IntegerLike;
  delegation_root: string;
  staker_registry_root: string;
}
