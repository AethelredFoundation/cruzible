from __future__ import annotations

import hashlib
import struct
from typing import Iterable

from Crypto.Hash import keccak

from .types import (
    DelegationPayloadInput,
    IntegerLike,
    RewardPayloadInput,
    ScoredValidator,
    SelectionConfig,
    StakerStake,
)


def _strip_hex_prefix(value: str) -> str:
    if value.startswith(("0x", "0X")):
        return value[2:]
    return value


def bytes_to_hex(value: bytes) -> str:
    return "0x" + value.hex()


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def _int_from(value: IntegerLike) -> int:
    return int(value)


def _uint256(value: IntegerLike) -> bytes:
    integer = _int_from(value)
    if integer < 0:
        raise ValueError("uint256 cannot be negative")
    return integer.to_bytes(32, "big", signed=False)


def _u64_word(value: IntegerLike) -> bytes:
    integer = _int_from(value)
    if integer < 0 or integer > 0xFFFF_FFFF_FFFF_FFFF:
        raise ValueError("value exceeds uint64")
    return integer.to_bytes(32, "big", signed=False)


def _bytes32_from_hex(value: str) -> bytes:
    raw = bytes.fromhex(_strip_hex_prefix(value))
    if len(raw) > 32:
      raise ValueError("value exceeds bytes32")
    return b"\x00" * (32 - len(raw)) + raw


def _addressish_bytes32(value: str) -> bytes:
    normalized = _strip_hex_prefix(value)
    try:
        raw = bytes.fromhex(normalized)
        if len(raw) <= 32:
            return b"\x00" * (32 - len(raw)) + raw
    except ValueError:
        pass
    fallback = _sha256(value.encode("utf-8"))[:20]
    return b"\x00" * 12 + fallback


def _tee_key_bytes32(value: str) -> bytes:
    normalized = _strip_hex_prefix(value)
    try:
        raw = bytes.fromhex(normalized)
    except ValueError:
        raw = b""
    return raw[:32].ljust(32, b"\x00")


def _parse_address_bytes20(value: str) -> bytes:
    normalized = _strip_hex_prefix(value).lower()
    try:
        raw = bytes.fromhex(normalized)
    except ValueError:
        return b"\x00" * 20
    if len(raw) == 20:
        return raw
    if len(raw) < 20:
        return b"\x00" * (20 - len(raw)) + raw
    return b"\x00" * 20


def compute_validator_set_hash(epoch: IntegerLike, validators: Iterable[ScoredValidator]) -> bytes:
    validator_list = list(validators)
    outer = hashlib.sha256()
    outer.update(b"CruzibleValidatorSet-v1")
    outer.update(_int_from(epoch).to_bytes(8, "big", signed=False))
    outer.update(len(validator_list).to_bytes(4, "big", signed=False))

    for validator in validator_list:
        inner = hashlib.sha256()
        inner.update(_addressish_bytes32(validator.address))
        inner.update(_uint256(validator.stake))
        inner.update(_uint256(validator.performance_score))
        inner.update(_uint256(validator.decentralization_score))
        inner.update(_uint256(validator.reputation_score))
        inner.update(_uint256(validator.composite_score))
        inner.update(_tee_key_bytes32(validator.tee_public_key))
        inner.update(_uint256(validator.commission_bps))
        outer.update(inner.digest())

    return outer.digest()


def compute_selection_policy_hash(config: SelectionConfig) -> bytes:
    parts = [
        b"CruzibleSelectionPolicy-v1",
        struct.pack(">d", config.performance_weight),
        struct.pack(">d", config.decentralization_weight),
        struct.pack(">d", config.reputation_weight),
        struct.pack(">d", config.min_uptime_pct),
        _uint256(config.max_commission_bps),
        _uint256(config.max_per_region),
        _uint256(config.max_per_operator),
        _uint256(config.min_stake),
    ]
    return _sha256(b"".join(parts))


def compute_eligible_universe_hash(addresses: Iterable[str]) -> bytes:
    sorted_addresses = sorted(addresses)
    payload = b"".join(address.encode("utf-8") + b"\x00" for address in sorted_addresses)
    return _sha256(payload)


def compute_stake_snapshot_hash(epoch: IntegerLike, stakers: Iterable[StakerStake]) -> bytes:
    staker_list = sorted(list(stakers), key=lambda staker: staker.address)
    outer = hashlib.sha256()
    outer.update(b"CruzibleStakeSnapshot-v1")
    outer.update(_int_from(epoch).to_bytes(8, "big", signed=False))
    outer.update(len(staker_list).to_bytes(4, "big", signed=False))

    for staker in staker_list:
        inner = hashlib.sha256()
        inner.update(_addressish_bytes32(staker.address))
        inner.update(_uint256(staker.shares))
        inner.update(_addressish_bytes32(staker.delegated_to))
        outer.update(inner.digest())

    return outer.digest()


def validate_unique_staker_addresses(stakers: Iterable[StakerStake]) -> None:
    seen: set[str] = set()
    for staker in stakers:
        if staker.address in seen:
            raise ValueError(f"duplicate staker address: {staker.address}")
        seen.add(staker.address)


def compute_staker_registry_root(stakers: Iterable[StakerStake]) -> bytes:
    staker_list = list(stakers)
    validate_unique_staker_addresses(staker_list)
    accumulator = bytearray(32)
    for staker in staker_list:
        if _int_from(staker.shares) == 0:
            continue
        leaf = _parse_address_bytes20(staker.address) + _uint256(staker.shares)
        digest = keccak.new(digest_bits=256, data=leaf).digest()
        for index in range(32):
            accumulator[index] ^= digest[index]
    return bytes(accumulator)


def compute_delegation_registry_root(stakers: Iterable[StakerStake]) -> bytes:
    staker_list = list(stakers)
    validate_unique_staker_addresses(staker_list)
    accumulator = bytearray(32)
    for staker in staker_list:
        if _int_from(staker.shares) == 0:
            continue
        leaf = _parse_address_bytes20(staker.address) + _parse_address_bytes20(staker.delegated_to)
        digest = keccak.new(digest_bits=256, data=leaf).digest()
        for index in range(32):
            accumulator[index] ^= digest[index]
    return bytes(accumulator)


def compute_canonical_validator_payload(
    epoch: IntegerLike,
    validators: Iterable[ScoredValidator],
    config: SelectionConfig,
    eligible_addresses: Iterable[str],
) -> bytes:
    validator_list = list(validators)
    return b"".join(
        [
            compute_validator_set_hash(epoch, validator_list),
            compute_selection_policy_hash(config),
            compute_eligible_universe_hash(list(eligible_addresses)),
        ]
    )


def compute_canonical_reward_payload(input_data: RewardPayloadInput) -> bytes:
    return b"".join(
        [
            _u64_word(input_data.epoch),
            _uint256(input_data.total_rewards),
            _bytes32_from_hex(input_data.merkle_root),
            _uint256(input_data.protocol_fee),
            _bytes32_from_hex(input_data.stake_snapshot_hash),
            _bytes32_from_hex(input_data.validator_set_hash),
            _bytes32_from_hex(input_data.staker_registry_root),
            _bytes32_from_hex(input_data.delegation_registry_root),
        ]
    )


def compute_canonical_delegation_payload(input_data: DelegationPayloadInput) -> bytes:
    return b"".join(
        [
            _u64_word(input_data.epoch),
            _bytes32_from_hex(input_data.delegation_root),
            _bytes32_from_hex(input_data.staker_registry_root),
        ]
    )


def validator_from_mapping(mapping: dict) -> ScoredValidator:
    return ScoredValidator(**mapping)


def selection_config_from_mapping(mapping: dict) -> SelectionConfig:
    return SelectionConfig(**mapping)


def staker_from_mapping(mapping: dict) -> StakerStake:
    return StakerStake(**mapping)


def reward_input_from_mapping(mapping: dict) -> RewardPayloadInput:
    return RewardPayloadInput(**mapping)


def delegation_input_from_mapping(mapping: dict) -> DelegationPayloadInput:
    return DelegationPayloadInput(**mapping)
