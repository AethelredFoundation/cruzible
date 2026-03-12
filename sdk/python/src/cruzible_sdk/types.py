from __future__ import annotations

from dataclasses import dataclass
from typing import Union


IntegerLike = Union[int, str]


@dataclass(frozen=True)
class ScoredValidator:
    address: str
    stake: IntegerLike
    performance_score: int
    decentralization_score: int
    reputation_score: int
    composite_score: int
    tee_public_key: str
    commission_bps: int
    rank: int


@dataclass(frozen=True)
class SelectionConfig:
    performance_weight: float
    decentralization_weight: float
    reputation_weight: float
    min_uptime_pct: float
    max_commission_bps: int
    max_per_region: int
    max_per_operator: int
    min_stake: IntegerLike


@dataclass(frozen=True)
class StakerStake:
    address: str
    shares: IntegerLike
    delegated_to: str


@dataclass(frozen=True)
class RewardPayloadInput:
    epoch: IntegerLike
    total_rewards: IntegerLike
    merkle_root: str
    protocol_fee: IntegerLike
    stake_snapshot_hash: str
    validator_set_hash: str
    staker_registry_root: str
    delegation_registry_root: str


@dataclass(frozen=True)
class DelegationPayloadInput:
    epoch: IntegerLike
    delegation_root: str
    staker_registry_root: str
