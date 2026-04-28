#!/usr/bin/env python3
"""Validate Cruzible contract release manifests.

This intentionally avoids third-party dependencies so operators can run it in
local shells, CI, and release workstations with only Python 3 available.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


EXPECTED_ARTIFACTS = {
    "vault": "aethel_vault.wasm",
    "ai_job_manager": "ai_job_manager.wasm",
    "cw20_staking": "cw20_staking.wasm",
    "governance": "governance.wasm",
    "model_registry": "model_registry.wasm",
    "seal_manager": "seal_manager.wasm",
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TX_RE = re.compile(r"^[0-9A-Fa-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ISO_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
BASIS_POINTS_DENOMINATOR = 10_000
MAX_GOVERNANCE_FEEDERS = 50
PRODUCTION_FEEDER_MUTATION_AUTHORITY = "governance"
MAX_CW20_DECIMALS = 18
VAULT_MAX_FEE_BPS = 1_000
VAULT_MIN_SEED_AMOUNT = 1_000_000
VAULT_MIN_UNBONDING_PERIOD_SECONDS = 86_400
AI_JOB_MAX_PLATFORM_FEE_BPS = 2_000
MAX_REQUIRED_TEE_TYPE = 3


def fail(message: str) -> None:
    print(f"release manifest validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_mapping(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{path} must be an object")
    return value


def require_list(value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{path} must be an array")
    return value


def require_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{path} must be a non-empty string")
    return value


def require_int(value: Any, path: str) -> int:
    if not isinstance(value, int) or value <= 0:
        fail(f"{path} must be a positive integer")
    return value


def require_non_negative_int(value: Any, path: str) -> int:
    if not isinstance(value, int) or value < 0:
        fail(f"{path} must be a non-negative integer")
    return value


def require_bool(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        fail(f"{path} must be a boolean")
    return value


def require_numeric_string(value: Any, path: str) -> str:
    text = require_string(value, path)
    if not text.isdigit():
        fail(f"{path} must be a decimal string")
    return text


def require_uint128_string(value: Any, path: str, *, allow_zero: bool = True) -> str:
    text = require_numeric_string(value, path)
    if not allow_zero and int(text) == 0:
        fail(f"{path} must be greater than zero")
    return text


def require_unique_string_list(value: Any, path: str, *, min_length: int = 0) -> list[str]:
    items = require_list(value, path)
    if len(items) < min_length:
        fail(f"{path} must contain at least {min_length} entries")

    seen: set[str] = set()
    strings: list[str] = []
    for index, item in enumerate(items):
        text = require_string(item, f"{path}[{index}]")
        if text in seen:
            fail(f"{path} contains duplicate {text}")
        seen.add(text)
        strings.append(text)
    return strings


def validate_basis_points(value: Any, path: str, *, allow_zero: bool = True) -> int:
    if allow_zero:
        if not isinstance(value, int) or value < 0:
            fail(f"{path} must be a non-negative integer")
        amount = value
    else:
        amount = require_int(value, path)
    if amount > BASIS_POINTS_DENOMINATOR:
        fail(f"{path} cannot exceed {BASIS_POINTS_DENOMINATOR}")
    return amount


def validate_required_role(roles: dict[str, Any], key: str, path: str) -> str:
    return require_string(roles.get(key), f"{path}.roles.{key}")


def validate_required_config_string(config: dict[str, Any], key: str, path: str) -> str:
    return require_string(config.get(key), f"{path}.config.{key}")


def validate_governance_contract(
    roles: dict[str, Any],
    config: dict[str, Any],
    contract_path: str,
) -> None:
    feeders = require_list(roles.get("total_bonded_feeders"), f"{contract_path}.roles.total_bonded_feeders")
    feeder_addresses: set[str] = set()
    for feeder_index, feeder in enumerate(feeders):
        address = require_string(
            feeder,
            f"{contract_path}.roles.total_bonded_feeders[{feeder_index}]",
        )
        if address in feeder_addresses:
            fail(f"{contract_path}.roles.total_bonded_feeders contains duplicate {address}")
        feeder_addresses.add(address)

    if len(feeder_addresses) < 3:
        fail(f"{contract_path}.roles.total_bonded_feeders must contain at least 3 feeders")

    for key in ("quorum_bps", "threshold_bps", "veto_threshold_bps", "feeder_tolerance_bps"):
        validate_basis_points(config.get(key), f"{contract_path}.config.{key}", allow_zero=False)

    authority = require_string(
        config.get("feeder_mutation_authority"),
        f"{contract_path}.config.feeder_mutation_authority",
    )
    if authority != PRODUCTION_FEEDER_MUTATION_AUTHORITY:
        fail(
            f"{contract_path}.config.feeder_mutation_authority must be "
            f"{PRODUCTION_FEEDER_MUTATION_AUTHORITY}"
        )

    min_feeder_quorum = require_int(
        config.get("min_feeder_quorum"),
        f"{contract_path}.config.min_feeder_quorum",
    )
    if min_feeder_quorum > len(feeder_addresses):
        fail(f"{contract_path}.config.min_feeder_quorum cannot exceed configured feeder count")

    max_feeders = require_int(config.get("max_feeders"), f"{contract_path}.config.max_feeders")
    if max_feeders > MAX_GOVERNANCE_FEEDERS:
        fail(f"{contract_path}.config.max_feeders cannot exceed {MAX_GOVERNANCE_FEEDERS}")
    if len(feeder_addresses) > max_feeders:
        fail(f"{contract_path}.roles.total_bonded_feeders exceeds max_feeders")

    require_int(
        config.get("feeder_mutation_cooldown_seconds"),
        f"{contract_path}.config.feeder_mutation_cooldown_seconds",
    )
    require_int(
        config.get("feeder_quarantine_period_seconds"),
        f"{contract_path}.config.feeder_quarantine_period_seconds",
    )


def parse_instantiate_funds(contract: dict[str, Any], contract_path: str) -> dict[str, str]:
    funds = require_list(contract.get("instantiate_funds"), f"{contract_path}.instantiate_funds")
    coins: dict[str, str] = {}
    for index, raw_coin in enumerate(funds):
        coin = require_mapping(raw_coin, f"{contract_path}.instantiate_funds[{index}]")
        denom = require_string(coin.get("denom"), f"{contract_path}.instantiate_funds[{index}].denom")
        amount = require_uint128_string(coin.get("amount"), f"{contract_path}.instantiate_funds[{index}].amount")
        if denom in coins:
            fail(f"{contract_path}.instantiate_funds contains duplicate denom {denom}")
        coins[denom] = amount
    return coins


def require_no_instantiate_funds(contract: dict[str, Any], contract_path: str) -> None:
    funds = parse_instantiate_funds(contract, contract_path)
    if funds:
        fail(f"{contract_path}.instantiate_funds must be empty")


def validate_cw20_instantiate(contract: dict[str, Any]) -> None:
    path = "$.contracts[cw20_staking]"
    msg_path = f"{path}.instantiate_msg"
    msg = require_mapping(contract.get("instantiate_msg"), msg_path)
    roles = require_mapping(contract.get("roles"), f"{path}.roles")
    config = require_mapping(contract.get("config"), f"{path}.config")
    require_no_instantiate_funds(contract, path)

    require_string(msg.get("name"), f"{msg_path}.name")
    if require_string(msg.get("symbol"), f"{msg_path}.symbol") != require_string(
        config.get("symbol"),
        f"{path}.config.symbol",
    ):
        fail(f"{msg_path}.symbol must match {path}.config.symbol")

    decimals = require_non_negative_int(msg.get("decimals"), f"{msg_path}.decimals")
    if decimals > MAX_CW20_DECIMALS:
        fail(f"{msg_path}.decimals cannot exceed {MAX_CW20_DECIMALS}")
    if decimals != require_non_negative_int(config.get("decimals"), f"{path}.config.decimals"):
        fail(f"{msg_path}.decimals must match {path}.config.decimals")

    if require_uint128_string(msg.get("initial_supply"), f"{msg_path}.initial_supply") != "0":
        fail(f"{msg_path}.initial_supply must be 0 for vault-controlled staking token supply")
    if require_string(msg.get("minter"), f"{msg_path}.minter") != validate_required_role(
        roles, "initial_minter", path
    ):
        fail(f"{msg_path}.minter must match {path}.roles.initial_minter")
    if require_uint128_string(msg.get("cap"), f"{msg_path}.cap") != require_uint128_string(
        config.get("cap"),
        f"{path}.config.cap",
    ):
        fail(f"{msg_path}.cap must match {path}.config.cap")


def validate_vault_instantiate(contract: dict[str, Any]) -> None:
    path = "$.contracts[vault]"
    msg_path = f"{path}.instantiate_msg"
    msg = require_mapping(contract.get("instantiate_msg"), msg_path)
    roles = require_mapping(contract.get("roles"), f"{path}.roles")
    config = require_mapping(contract.get("config"), f"{path}.config")

    unbonding_period = require_int(msg.get("unbonding_period"), f"{msg_path}.unbonding_period")
    if unbonding_period < VAULT_MIN_UNBONDING_PERIOD_SECONDS:
        fail(f"{msg_path}.unbonding_period must be at least {VAULT_MIN_UNBONDING_PERIOD_SECONDS}")
    if unbonding_period != require_int(
        config.get("unbonding_period_seconds"),
        f"{path}.config.unbonding_period_seconds",
    ):
        fail(f"{msg_path}.unbonding_period must match {path}.config.unbonding_period_seconds")

    denom = require_string(msg.get("denom"), f"{msg_path}.denom")
    if denom != require_string(config.get("denom"), f"{path}.config.denom"):
        fail(f"{msg_path}.denom must match {path}.config.denom")
    if require_string(msg.get("staking_token"), f"{msg_path}.staking_token") != require_string(
        config.get("staking_token"),
        f"{path}.config.staking_token",
    ):
        fail(f"{msg_path}.staking_token must match {path}.config.staking_token")

    require_unique_string_list(msg.get("validators"), f"{msg_path}.validators", min_length=1)
    fee_bps = validate_basis_points(msg.get("fee_bps"), f"{msg_path}.fee_bps")
    if fee_bps > VAULT_MAX_FEE_BPS:
        fail(f"{msg_path}.fee_bps cannot exceed {VAULT_MAX_FEE_BPS}")

    min_stake = int(require_uint128_string(msg.get("min_stake"), f"{msg_path}.min_stake", allow_zero=False))
    max_stake = int(require_uint128_string(msg.get("max_stake"), f"{msg_path}.max_stake", allow_zero=False))
    if min_stake < VAULT_MIN_SEED_AMOUNT:
        fail(f"{msg_path}.min_stake must be at least {VAULT_MIN_SEED_AMOUNT}")
    if min_stake > max_stake:
        fail(f"{msg_path}.min_stake cannot exceed {msg_path}.max_stake")

    if require_string(msg.get("operator"), f"{msg_path}.operator") != validate_required_role(roles, "operator", path):
        fail(f"{msg_path}.operator must match {path}.roles.operator")
    if require_string(msg.get("pauser"), f"{msg_path}.pauser") != validate_required_role(roles, "pauser", path):
        fail(f"{msg_path}.pauser must match {path}.roles.pauser")

    funds = parse_instantiate_funds(contract, path)
    if set(funds) != {denom}:
        fail(f"{path}.instantiate_funds must include exactly one {denom} seed coin")
    if int(funds[denom]) < VAULT_MIN_SEED_AMOUNT:
        fail(f"{path}.instantiate_funds {denom} amount must be at least {VAULT_MIN_SEED_AMOUNT}")


def validate_ai_job_manager_instantiate(contract: dict[str, Any]) -> None:
    path = "$.contracts[ai_job_manager]"
    msg_path = f"{path}.instantiate_msg"
    msg = require_mapping(contract.get("instantiate_msg"), msg_path)
    roles = require_mapping(contract.get("roles"), f"{path}.roles")
    config = require_mapping(contract.get("config"), f"{path}.config")
    require_no_instantiate_funds(contract, path)

    if require_string(msg.get("payment_denom"), f"{msg_path}.payment_denom") != require_string(
        config.get("payment_denom"),
        f"{path}.config.payment_denom",
    ):
        fail(f"{msg_path}.payment_denom must match {path}.config.payment_denom")

    min_timeout = require_int(msg.get("min_timeout"), f"{msg_path}.min_timeout")
    max_timeout = require_int(msg.get("max_timeout"), f"{msg_path}.max_timeout")
    if min_timeout > max_timeout:
        fail(f"{msg_path}.min_timeout cannot exceed {msg_path}.max_timeout")
    require_uint128_string(msg.get("min_payment"), f"{msg_path}.min_payment", allow_zero=False)

    platform_fee_bps = validate_basis_points(msg.get("platform_fee_bps"), f"{msg_path}.platform_fee_bps")
    if platform_fee_bps > AI_JOB_MAX_PLATFORM_FEE_BPS:
        fail(f"{msg_path}.platform_fee_bps cannot exceed {AI_JOB_MAX_PLATFORM_FEE_BPS}")
    required_tee_type = require_non_negative_int(msg.get("required_tee_type"), f"{msg_path}.required_tee_type")
    if required_tee_type > MAX_REQUIRED_TEE_TYPE:
        fail(f"{msg_path}.required_tee_type cannot exceed {MAX_REQUIRED_TEE_TYPE}")

    if require_string(msg.get("fee_collector"), f"{msg_path}.fee_collector") != validate_required_role(
        roles, "fee_collector", path
    ):
        fail(f"{msg_path}.fee_collector must match {path}.roles.fee_collector")
    if require_string(msg.get("model_registry"), f"{msg_path}.model_registry") != require_string(
        config.get("model_registry"),
        f"{path}.config.model_registry",
    ):
        fail(f"{msg_path}.model_registry must match {path}.config.model_registry")


def validate_model_registry_instantiate(contract: dict[str, Any]) -> None:
    path = "$.contracts[model_registry]"
    msg_path = f"{path}.instantiate_msg"
    msg = require_mapping(contract.get("instantiate_msg"), msg_path)
    config = require_mapping(contract.get("config"), f"{path}.config")
    require_no_instantiate_funds(contract, path)

    if require_uint128_string(msg.get("registration_fee"), f"{msg_path}.registration_fee") != require_numeric_string(
        config.get("registration_fee"),
        f"{path}.config.registration_fee",
    ):
        fail(f"{msg_path}.registration_fee must match {path}.config.registration_fee")
    if require_string(msg.get("registration_fee_denom"), f"{msg_path}.registration_fee_denom") != require_string(
        config.get("registration_fee_denom"),
        f"{path}.config.registration_fee_denom",
    ):
        fail(f"{msg_path}.registration_fee_denom must match {path}.config.registration_fee_denom")
    verification_required = require_bool(msg.get("verification_required"), f"{msg_path}.verification_required")
    verifiers = require_unique_string_list(msg.get("verifiers"), f"{msg_path}.verifiers")
    if verification_required and not verifiers:
        fail(f"{msg_path}.verifiers must not be empty when verification_required is true")


def validate_seal_manager_instantiate(contract: dict[str, Any]) -> None:
    path = "$.contracts[seal_manager]"
    msg_path = f"{path}.instantiate_msg"
    msg = require_mapping(contract.get("instantiate_msg"), msg_path)
    roles = require_mapping(contract.get("roles"), f"{path}.roles")
    config = require_mapping(contract.get("config"), f"{path}.config")
    require_no_instantiate_funds(contract, path)

    if require_string(msg.get("ai_job_manager"), f"{msg_path}.ai_job_manager") != validate_required_role(
        roles, "ai_job_manager", path
    ):
        fail(f"{msg_path}.ai_job_manager must match {path}.roles.ai_job_manager")
    min_validators = require_int(msg.get("min_validators"), f"{msg_path}.min_validators")
    max_validators = require_int(msg.get("max_validators"), f"{msg_path}.max_validators")
    if min_validators > max_validators:
        fail(f"{msg_path}.min_validators cannot exceed {msg_path}.max_validators")
    if min_validators != require_int(config.get("min_validators"), f"{path}.config.min_validators"):
        fail(f"{msg_path}.min_validators must match {path}.config.min_validators")
    if max_validators != require_int(config.get("max_validators"), f"{path}.config.max_validators"):
        fail(f"{msg_path}.max_validators must match {path}.config.max_validators")

    default_expiration = require_int(msg.get("default_expiration"), f"{msg_path}.default_expiration")
    max_expiration = require_int(msg.get("max_expiration"), f"{msg_path}.max_expiration")
    if default_expiration > max_expiration:
        fail(f"{msg_path}.default_expiration cannot exceed {msg_path}.max_expiration")


def validate_governance_instantiate(contract: dict[str, Any]) -> None:
    path = "$.contracts[governance]"
    msg_path = f"{path}.instantiate_msg"
    msg = require_mapping(contract.get("instantiate_msg"), msg_path)
    roles = require_mapping(contract.get("roles"), f"{path}.roles")
    config = require_mapping(contract.get("config"), f"{path}.config")
    require_no_instantiate_funds(contract, path)

    for key in ("voting_period", "execution_delay", "snapshot_period", "max_staleness", "min_activation_gap"):
        require_int(msg.get(key), f"{msg_path}.{key}")
    require_uint128_string(msg.get("min_deposit"), f"{msg_path}.min_deposit", allow_zero=False)
    require_string(msg.get("deposit_denom"), f"{msg_path}.deposit_denom")

    governance_bps_fields = {
        "quorum": "quorum_bps",
        "threshold": "threshold_bps",
        "veto_threshold": "veto_threshold_bps",
        "max_delta_bps": "max_delta_bps",
        "feeder_tolerance_bps": "feeder_tolerance_bps",
    }
    for msg_key, config_key in governance_bps_fields.items():
        msg_value = validate_basis_points(msg.get(msg_key), f"{msg_path}.{msg_key}", allow_zero=False)
        if config_key in config and msg_value != validate_basis_points(
            config.get(config_key),
            f"{path}.config.{config_key}",
            allow_zero=False,
        ):
            fail(f"{msg_path}.{msg_key} must match {path}.config.{config_key}")

    min_feeder_quorum = require_int(msg.get("min_feeder_quorum"), f"{msg_path}.min_feeder_quorum")
    if min_feeder_quorum != require_int(config.get("min_feeder_quorum"), f"{path}.config.min_feeder_quorum"):
        fail(f"{msg_path}.min_feeder_quorum must match {path}.config.min_feeder_quorum")
    if require_int(msg.get("feeder_mutation_cooldown"), f"{msg_path}.feeder_mutation_cooldown") != require_int(
        config.get("feeder_mutation_cooldown_seconds"),
        f"{path}.config.feeder_mutation_cooldown_seconds",
    ):
        fail(f"{msg_path}.feeder_mutation_cooldown must match {path}.config.feeder_mutation_cooldown_seconds")
    if require_int(msg.get("feeder_quarantine_period"), f"{msg_path}.feeder_quarantine_period") != require_int(
        config.get("feeder_quarantine_period_seconds"),
        f"{path}.config.feeder_quarantine_period_seconds",
    ):
        fail(f"{msg_path}.feeder_quarantine_period must match {path}.config.feeder_quarantine_period_seconds")
    if require_string(msg.get("feeder_mutation_authority"), f"{msg_path}.feeder_mutation_authority") != require_string(
        config.get("feeder_mutation_authority"),
        f"{path}.config.feeder_mutation_authority",
    ):
        fail(f"{msg_path}.feeder_mutation_authority must match {path}.config.feeder_mutation_authority")

    initial_feeders = require_unique_string_list(
        msg.get("initial_feeders"),
        f"{msg_path}.initial_feeders",
        min_length=3,
    )
    manifest_feeders = require_unique_string_list(
        roles.get("total_bonded_feeders"),
        f"{path}.roles.total_bonded_feeders",
        min_length=3,
    )
    if initial_feeders != manifest_feeders:
        fail(f"{msg_path}.initial_feeders must match {path}.roles.total_bonded_feeders")


def validate_contract_instantiation(contracts: dict[str, dict[str, Any]]) -> None:
    validate_cw20_instantiate(contracts["cw20_staking"])
    validate_vault_instantiate(contracts["vault"])
    validate_ai_job_manager_instantiate(contracts["ai_job_manager"])
    validate_model_registry_instantiate(contracts["model_registry"])
    validate_seal_manager_instantiate(contracts["seal_manager"])
    validate_governance_instantiate(contracts["governance"])


def validate_contract_wiring(contracts: dict[str, dict[str, Any]]) -> None:
    cw20 = contracts["cw20_staking"]
    vault = contracts["vault"]
    ai_jobs = contracts["ai_job_manager"]
    model_registry = contracts["model_registry"]
    seal_manager = contracts["seal_manager"]

    cw20_path = "$.contracts[cw20_staking]"
    vault_path = "$.contracts[vault]"
    ai_jobs_path = "$.contracts[ai_job_manager]"
    model_registry_path = "$.contracts[model_registry]"
    seal_manager_path = "$.contracts[seal_manager]"

    cw20_roles = require_mapping(cw20.get("roles"), f"{cw20_path}.roles")
    vault_roles = require_mapping(vault.get("roles"), f"{vault_path}.roles")
    ai_jobs_roles = require_mapping(ai_jobs.get("roles"), f"{ai_jobs_path}.roles")
    model_registry_roles = require_mapping(model_registry.get("roles"), f"{model_registry_path}.roles")
    seal_manager_roles = require_mapping(seal_manager.get("roles"), f"{seal_manager_path}.roles")

    cw20_config = require_mapping(cw20.get("config"), f"{cw20_path}.config")
    vault_config = require_mapping(vault.get("config"), f"{vault_path}.config")
    ai_jobs_config = require_mapping(ai_jobs.get("config"), f"{ai_jobs_path}.config")
    model_registry_config = require_mapping(model_registry.get("config"), f"{model_registry_path}.config")
    seal_manager_config = require_mapping(seal_manager.get("config"), f"{seal_manager_path}.config")

    validate_required_role(cw20_roles, "initial_minter", cw20_path)
    if validate_required_role(cw20_roles, "minter", cw20_path) != vault["address"]:
        fail(f"{cw20_path}.roles.minter must match vault address")

    for role in ("operator", "pauser"):
        validate_required_role(vault_roles, role, vault_path)
    if validate_required_config_string(vault_config, "staking_token", vault_path) != cw20["address"]:
        fail(f"{vault_path}.config.staking_token must match cw20_staking address")
    validate_required_config_string(vault_config, "denom", vault_path)
    require_int(vault_config.get("unbonding_period_seconds"), f"{vault_path}.config.unbonding_period_seconds")

    validate_required_role(ai_jobs_roles, "fee_collector", ai_jobs_path)
    if validate_required_config_string(ai_jobs_config, "model_registry", ai_jobs_path) != model_registry["address"]:
        fail(f"{ai_jobs_path}.config.model_registry must match model_registry address")
    validate_required_config_string(ai_jobs_config, "payment_denom", ai_jobs_path)

    if validate_required_role(model_registry_roles, "ai_job_manager", model_registry_path) != ai_jobs["address"]:
        fail(f"{model_registry_path}.roles.ai_job_manager must match ai_job_manager address")
    require_numeric_string(
        model_registry_config.get("registration_fee"),
        f"{model_registry_path}.config.registration_fee",
    )
    validate_required_config_string(model_registry_config, "registration_fee_denom", model_registry_path)

    if validate_required_role(seal_manager_roles, "ai_job_manager", seal_manager_path) != ai_jobs["address"]:
        fail(f"{seal_manager_path}.roles.ai_job_manager must match ai_job_manager address")
    min_validators = require_int(
        seal_manager_config.get("min_validators"),
        f"{seal_manager_path}.config.min_validators",
    )
    max_validators = require_int(
        seal_manager_config.get("max_validators"),
        f"{seal_manager_path}.config.max_validators",
    )
    if min_validators > max_validators:
        fail(f"{seal_manager_path}.config.min_validators cannot exceed max_validators")


def validate_post_instantiate_actions(root: dict[str, Any], contracts: dict[str, dict[str, Any]]) -> None:
    actions = require_list(root.get("post_instantiate_actions"), "$.post_instantiate_actions")
    cw20 = contracts["cw20_staking"]
    vault = contracts["vault"]
    model_registry = contracts["model_registry"]
    ai_jobs = contracts["ai_job_manager"]

    cw20_minter_action = None
    model_registry_action = None
    for index, raw_action in enumerate(actions):
        action = require_mapping(raw_action, f"$.post_instantiate_actions[{index}]")
        name = require_string(action.get("name"), f"$.post_instantiate_actions[{index}].name")
        contract = require_string(action.get("contract"), f"$.post_instantiate_actions[{index}].contract")
        tx_hash = require_string(action.get("tx_hash"), f"$.post_instantiate_actions[{index}].tx_hash")
        if not TX_RE.fullmatch(tx_hash):
            fail(f"$.post_instantiate_actions[{index}].tx_hash must be 64 hex characters")
        require_string(action.get("actor"), f"$.post_instantiate_actions[{index}].actor")
        require_mapping(action.get("message"), f"$.post_instantiate_actions[{index}].message")

        if name == "cw20_staking_set_vault_minter":
            if cw20_minter_action is not None:
                fail("$.post_instantiate_actions contains duplicate cw20_staking_set_vault_minter")
            if contract != "cw20_staking":
                fail("cw20_staking_set_vault_minter must target cw20_staking")
            cw20_minter_action = (index, action)

        if name == "model_registry_set_ai_job_manager":
            if model_registry_action is not None:
                fail("$.post_instantiate_actions contains duplicate model_registry_set_ai_job_manager")
            if contract != "model_registry":
                fail("model_registry_set_ai_job_manager must target model_registry")
            model_registry_action = (index, action)

    if cw20_minter_action is None:
        fail("$.post_instantiate_actions must include cw20_staking_set_vault_minter")
    if model_registry_action is None:
        fail("$.post_instantiate_actions must include model_registry_set_ai_job_manager")

    index, action = cw20_minter_action
    cw20_roles = require_mapping(cw20.get("roles"), "$.contracts[cw20_staking].roles")
    if require_string(
        action.get("contract_address"),
        f"$.post_instantiate_actions[{index}].contract_address",
    ) != cw20["address"]:
        fail("cw20_staking_set_vault_minter contract_address must match cw20_staking address")
    if action["actor"] != cw20_roles["initial_minter"]:
        fail("cw20_staking_set_vault_minter actor must match cw20_staking initial_minter")

    message = require_mapping(action.get("message"), f"$.post_instantiate_actions[{index}].message")
    update_minter = require_mapping(
        message.get("update_minter"),
        f"$.post_instantiate_actions[{index}].message.update_minter",
    )
    if require_string(
        update_minter.get("new_minter"),
        f"$.post_instantiate_actions[{index}].message.update_minter.new_minter",
    ) != vault["address"]:
        fail("cw20_staking_set_vault_minter message must set the vault as final minter")

    index, action = model_registry_action
    if require_string(
        action.get("contract_address"),
        f"$.post_instantiate_actions[{index}].contract_address",
    ) != model_registry["address"]:
        fail("model_registry_set_ai_job_manager contract_address must match model_registry address")
    if action["actor"] != model_registry["admin"]:
        fail("model_registry_set_ai_job_manager actor must match model_registry admin")

    message = require_mapping(action.get("message"), f"$.post_instantiate_actions[{index}].message")
    update_config = require_mapping(
        message.get("update_config"),
        f"$.post_instantiate_actions[{index}].message.update_config",
    )
    if require_string(
        update_config.get("ai_job_manager"),
        f"$.post_instantiate_actions[{index}].message.update_config.ai_job_manager",
    ) != ai_jobs["address"]:
        fail("model_registry_set_ai_job_manager message must set ai_job_manager address")

    registration_fee = update_config.get("registration_fee")
    if registration_fee is not None:
        require_numeric_string(
            registration_fee,
            f"$.post_instantiate_actions[{index}].message.update_config.registration_fee",
        )
    registration_fee_denom = update_config.get("registration_fee_denom")
    if registration_fee_denom is not None:
        model_registry_config = require_mapping(model_registry.get("config"), "$.contracts[model_registry].config")
        if require_string(
            registration_fee_denom,
            f"$.post_instantiate_actions[{index}].message.update_config.registration_fee_denom",
        ) != require_string(
            model_registry_config.get("registration_fee_denom"),
            "$.contracts[model_registry].config.registration_fee_denom",
        ):
            fail("model_registry_set_ai_job_manager registration_fee_denom must match final config")


def read_json_file(path: Path, label: str) -> dict[str, Any]:
    try:
        return require_mapping(json.loads(path.read_text(encoding="utf-8")), label)
    except FileNotFoundError:
        fail(f"{label} not found: {path}")
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}")


def parse_sha256sums(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        fail(f"SHA256SUMS not found: {path}")

    checksums: dict[str, str] = {}
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 2:
            fail(f"{path}:{line_number} must contain '<sha256> <file>'")
        checksum, file_name = parts
        if not SHA256_RE.fullmatch(checksum):
            fail(f"{path}:{line_number} checksum must be 64 lowercase hex characters")
        if file_name in checksums:
            fail(f"{path}:{line_number} duplicate checksum entry for {file_name}")
        checksums[file_name] = checksum
    return checksums


def validate_strict_release_evidence(root: dict[str, Any]) -> None:
    source = require_mapping(root.get("source"), "$.source")
    git_commit = require_string(source.get("git_commit"), "$.source.git_commit")
    if not GIT_SHA_RE.fullmatch(git_commit) or set(git_commit) == {"0"}:
        fail("$.source.git_commit must be a real 40-character lowercase git SHA in strict mode")

    for key in ("artifact_manifest", "checksum_file", "signatures_file"):
        value = require_string(source.get(key), f"$.source.{key}")
        if "${" in value:
            fail(f"$.source.{key} cannot contain template placeholders in strict mode")
    signer_id = require_string(source.get("signer_id"), "$.source.signer_id")
    if "${" in signer_id:
        fail("$.source.signer_id cannot contain template placeholders in strict mode")

    for index, artifact in enumerate(require_list(root.get("artifacts"), "$.artifacts")):
        artifact_obj = require_mapping(artifact, f"$.artifacts[{index}]")
        for key in ("sha256", "upload_tx_hash"):
            value = require_string(artifact_obj.get(key), f"$.artifacts[{index}].{key}")
            if len(set(value.lower())) == 1:
                fail(f"$.artifacts[{index}].{key} appears to be placeholder evidence")

    for index, contract in enumerate(require_list(root.get("contracts"), "$.contracts")):
        contract_obj = require_mapping(contract, f"$.contracts[{index}]")
        tx_hash = require_string(contract_obj.get("instantiate_tx_hash"), f"$.contracts[{index}].instantiate_tx_hash")
        if len(set(tx_hash.lower())) == 1:
            fail(f"$.contracts[{index}].instantiate_tx_hash appears to be placeholder evidence")

    for index, action in enumerate(require_list(root.get("post_instantiate_actions"), "$.post_instantiate_actions")):
        action_obj = require_mapping(action, f"$.post_instantiate_actions[{index}]")
        tx_hash = require_string(action_obj.get("tx_hash"), f"$.post_instantiate_actions[{index}].tx_hash")
        if len(set(tx_hash.lower())) == 1:
            fail(f"$.post_instantiate_actions[{index}].tx_hash appears to be placeholder evidence")

    signoff = require_mapping(root.get("operator_signoff"), "$.operator_signoff")
    prepared_at = require_string(signoff.get("prepared_at"), "$.operator_signoff.prepared_at")
    if not ISO_UTC_RE.fullmatch(prepared_at):
        fail("$.operator_signoff.prepared_at must use YYYY-MM-DDTHH:MM:SSZ")
    notes = require_string(signoff.get("notes"), "$.operator_signoff.notes").lower()
    if "example" in notes or "replace" in notes:
        fail("$.operator_signoff.notes must describe real deployment evidence in strict mode")


def validate_artifact_reconciliation(root: dict[str, Any], artifact_dir: Path) -> None:
    source = require_mapping(root.get("source"), "$.source")
    artifact_manifest_ref = require_string(source.get("artifact_manifest"), "$.source.artifact_manifest")
    checksum_file_ref = require_string(source.get("checksum_file"), "$.source.checksum_file")
    signatures_file_ref = require_string(source.get("signatures_file"), "$.source.signatures_file")
    signer_id = require_string(source.get("signer_id"), "$.source.signer_id")

    if Path(artifact_manifest_ref).name != "manifest.json":
        fail("$.source.artifact_manifest must reference manifest.json")
    if Path(checksum_file_ref).name != "SHA256SUMS":
        fail("$.source.checksum_file must reference SHA256SUMS")
    if Path(signatures_file_ref).name != "signatures.json":
        fail("$.source.signatures_file must reference signatures.json")

    artifact_manifest = read_json_file(artifact_dir / "manifest.json", "artifact manifest")
    if artifact_manifest.get("schema") != "cruzible.contract_audit_artifacts.v1":
        fail("artifact manifest schema must be cruzible.contract_audit_artifacts.v1")
    if require_string(artifact_manifest.get("git_commit"), "artifact manifest.git_commit") != require_string(
        source.get("git_commit"), "$.source.git_commit"
    ):
        fail("$.source.git_commit must match artifact manifest git_commit")

    artifact_entries = require_list(artifact_manifest.get("artifacts"), "artifact manifest.artifacts")
    artifact_by_file: dict[str, dict[str, Any]] = {}
    for index, artifact in enumerate(artifact_entries):
        artifact_obj = require_mapping(artifact, f"artifact manifest.artifacts[{index}]")
        file_name = require_string(artifact_obj.get("file"), f"artifact manifest.artifacts[{index}].file")
        if file_name in artifact_by_file:
            fail(f"artifact manifest contains duplicate file {file_name}")
        artifact_by_file[file_name] = artifact_obj

    checksums = parse_sha256sums(artifact_dir / "SHA256SUMS")
    release_artifacts = [
        require_mapping(artifact, f"$.artifacts[{index}]")
        for index, artifact in enumerate(require_list(root.get("artifacts"), "$.artifacts"))
    ]
    release_files = {
        require_string(artifact.get("file"), f"$.artifacts[{index}].file")
        for index, artifact in enumerate(release_artifacts)
    }
    if set(artifact_by_file) != release_files:
        fail("artifact manifest files must exactly match release manifest artifacts")
    if set(checksums) != release_files:
        fail("SHA256SUMS files must exactly match release manifest artifacts")

    for index, release_artifact in enumerate(release_artifacts):
        file_name = require_string(release_artifact.get("file"), f"$.artifacts[{index}].file")
        artifact_entry = artifact_by_file.get(file_name)
        if artifact_entry is None:
            fail(f"artifact manifest is missing release artifact {file_name}")
        if require_string(release_artifact.get("sha256"), f"$.artifacts[{index}].sha256") != require_string(
            artifact_entry.get("sha256"), f"artifact manifest entry {file_name}.sha256"
        ):
            fail(f"$.artifacts[{index}].sha256 must match artifact manifest for {file_name}")
        if require_int(release_artifact.get("bytes"), f"$.artifacts[{index}].bytes") != require_int(
            artifact_entry.get("bytes"), f"artifact manifest entry {file_name}.bytes"
        ):
            fail(f"$.artifacts[{index}].bytes must match artifact manifest for {file_name}")
        if checksums.get(file_name) != release_artifact["sha256"]:
            fail(f"SHA256SUMS must match release manifest sha256 for {file_name}")

    signatures = read_json_file(artifact_dir / "signatures.json", "signatures manifest")
    if signatures.get("schema") != "cruzible.contract_artifact_signatures.v1":
        fail("signatures manifest schema must be cruzible.contract_artifact_signatures.v1")
    if require_string(signatures.get("signer_id"), "signatures manifest.signer_id") != signer_id:
        fail("$.source.signer_id must match signatures manifest signer_id")

    signature_entries = require_list(signatures.get("entries"), "signatures manifest.entries")
    signatures_by_file: dict[str, str] = {}
    for index, entry in enumerate(signature_entries):
        entry_obj = require_mapping(entry, f"signatures manifest.entries[{index}]")
        file_name = require_string(entry_obj.get("file"), f"signatures manifest.entries[{index}].file")
        signature = require_string(entry_obj.get("signature"), f"signatures manifest.entries[{index}].signature")
        if file_name in signatures_by_file:
            fail(f"signatures manifest contains duplicate entry for {file_name}")
        signatures_by_file[file_name] = signature

    for payload in ("SHA256SUMS", "manifest.json"):
        signature = signatures_by_file.get(payload)
        if signature is None:
            fail(f"signatures manifest must include {payload}")
        if not (artifact_dir / signature).is_file():
            fail(f"detached signature file not found: {artifact_dir / signature}")


def validate_manifest(path: Path, *, strict: bool = False, artifact_dir: Path | None = None) -> None:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}")

    root = require_mapping(manifest, "$")
    if root.get("schema") != "cruzible.contract_release_manifest.v1":
        fail("$.schema must be cruzible.contract_release_manifest.v1")

    for key in ("release_id", "environment"):
        require_string(root.get(key), f"$.{key}")

    chain = require_mapping(root.get("chain"), "$.chain")
    for key in ("chain_id", "rpc_url"):
        require_string(chain.get(key), f"$.chain.{key}")

    source = require_mapping(root.get("source"), "$.source")
    for key in ("git_commit", "artifact_manifest", "checksum_file", "signatures_file", "signer_id"):
        require_string(source.get(key), f"$.source.{key}")

    artifacts = require_list(root.get("artifacts"), "$.artifacts")
    contracts = require_list(root.get("contracts"), "$.contracts")

    artifact_by_name: dict[str, dict[str, Any]] = {}
    code_ids: set[int] = set()
    for index, raw_artifact in enumerate(artifacts):
        artifact = require_mapping(raw_artifact, f"$.artifacts[{index}]")
        name = require_string(artifact.get("name"), f"$.artifacts[{index}].name")
        expected_file = EXPECTED_ARTIFACTS.get(name)
        if expected_file is None:
            fail(f"unexpected artifact name: {name}")
        if artifact_by_name.get(name) is not None:
            fail(f"duplicate artifact name: {name}")
        if require_string(artifact.get("file"), f"$.artifacts[{index}].file") != expected_file:
            fail(f"artifact {name} must use file {expected_file}")
        sha256 = require_string(artifact.get("sha256"), f"$.artifacts[{index}].sha256")
        if not SHA256_RE.fullmatch(sha256):
            fail(f"artifact {name} sha256 must be 64 lowercase hex characters")
        require_int(artifact.get("bytes"), f"$.artifacts[{index}].bytes")
        code_id = require_int(artifact.get("code_id"), f"$.artifacts[{index}].code_id")
        if code_id in code_ids:
            fail(f"duplicate code_id: {code_id}")
        code_ids.add(code_id)
        upload_tx_hash = require_string(
            artifact.get("upload_tx_hash"), f"$.artifacts[{index}].upload_tx_hash"
        )
        if not TX_RE.fullmatch(upload_tx_hash):
            fail(f"artifact {name} upload_tx_hash must be 64 hex characters")
        require_string(artifact.get("uploaded_by"), f"$.artifacts[{index}].uploaded_by")
        artifact_by_name[name] = artifact

    missing_artifacts = set(EXPECTED_ARTIFACTS) - set(artifact_by_name)
    if missing_artifacts:
        fail(f"missing artifacts: {', '.join(sorted(missing_artifacts))}")

    contract_names: set[str] = set()
    contract_by_name: dict[str, dict[str, Any]] = {}
    addresses: set[str] = set()
    for index, raw_contract in enumerate(contracts):
        contract = require_mapping(raw_contract, f"$.contracts[{index}]")
        name = require_string(contract.get("name"), f"$.contracts[{index}].name")
        if name not in EXPECTED_ARTIFACTS:
            fail(f"unexpected contract name: {name}")
        if name in contract_names:
            fail(f"duplicate contract name: {name}")
        contract_names.add(name)
        contract_by_name[name] = contract
        code_id = require_int(contract.get("code_id"), f"$.contracts[{index}].code_id")
        if artifact_by_name[name]["code_id"] != code_id:
            fail(f"contract {name} code_id must match its artifact code_id")
        address = require_string(contract.get("address"), f"$.contracts[{index}].address")
        if address in addresses:
            fail(f"duplicate contract address: {address}")
        addresses.add(address)
        instantiate_tx_hash = require_string(
            contract.get("instantiate_tx_hash"),
            f"$.contracts[{index}].instantiate_tx_hash",
        )
        if not TX_RE.fullmatch(instantiate_tx_hash):
            fail(f"contract {name} instantiate_tx_hash must be 64 hex characters")
        require_string(contract.get("admin"), f"$.contracts[{index}].admin")
        roles = require_mapping(contract.get("roles"), f"$.contracts[{index}].roles")
        config = require_mapping(contract.get("config"), f"$.contracts[{index}].config")
        if name == "governance":
            validate_governance_contract(roles, config, f"$.contracts[{index}]")

    missing_contracts = set(EXPECTED_ARTIFACTS) - contract_names
    if missing_contracts:
        fail(f"missing contracts: {', '.join(sorted(missing_contracts))}")

    validate_contract_instantiation(contract_by_name)
    validate_contract_wiring(contract_by_name)
    validate_post_instantiate_actions(root, contract_by_name)
    if strict:
        validate_strict_release_evidence(root)
    if artifact_dir is not None:
        validate_artifact_reconciliation(root, artifact_dir)

    require_mapping(root.get("operator_signoff"), "$.operator_signoff")
    mode = "strict " if strict else ""
    evidence = f" with artifacts from {artifact_dir}" if artifact_dir is not None else ""
    print(f"{mode}release manifest OK: {path}{evidence}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a Cruzible contract release manifest.")
    parser.add_argument("manifest", type=Path, help="Path to release manifest JSON")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Reject template placeholders and require real staging deployment evidence",
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        help="Reconcile release manifest artifacts with a signed audit artifact directory",
    )
    args = parser.parse_args()
    validate_manifest(args.manifest, strict=args.strict, artifact_dir=args.artifact_dir)


if __name__ == "__main__":
    main()
