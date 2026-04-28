#!/usr/bin/env python3
"""Validate Cruzible contract release manifests.

This intentionally avoids third-party dependencies so operators can run it in
local shells, CI, and release workstations with only Python 3 available.
"""

from __future__ import annotations

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
BASIS_POINTS_DENOMINATOR = 10_000
MAX_GOVERNANCE_FEEDERS = 50


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


def validate_manifest(path: Path) -> None:
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
    for key in ("git_commit", "artifact_manifest", "checksum_file"):
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
    addresses: set[str] = set()
    for index, raw_contract in enumerate(contracts):
        contract = require_mapping(raw_contract, f"$.contracts[{index}]")
        name = require_string(contract.get("name"), f"$.contracts[{index}].name")
        if name not in EXPECTED_ARTIFACTS:
            fail(f"unexpected contract name: {name}")
        if name in contract_names:
            fail(f"duplicate contract name: {name}")
        contract_names.add(name)
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

    require_mapping(root.get("operator_signoff"), "$.operator_signoff")
    print(f"release manifest OK: {path}")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: validate-release-manifest.py <manifest.json>")
    validate_manifest(Path(sys.argv[1]))


if __name__ == "__main__":
    main()
