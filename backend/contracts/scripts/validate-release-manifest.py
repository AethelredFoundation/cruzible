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


def require_numeric_string(value: Any, path: str) -> str:
    text = require_string(value, path)
    if not text.isdigit():
        fail(f"{path} must be a decimal string")
    return text


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
    require_numeric_string(model_registry_config.get("registration_fee"), f"{model_registry_path}.config.registration_fee")

    if validate_required_role(seal_manager_roles, "ai_job_manager", seal_manager_path) != ai_jobs["address"]:
        fail(f"{seal_manager_path}.roles.ai_job_manager must match ai_job_manager address")
    min_validators = require_int(seal_manager_config.get("min_validators"), f"{seal_manager_path}.config.min_validators")
    max_validators = require_int(seal_manager_config.get("max_validators"), f"{seal_manager_path}.config.max_validators")
    if min_validators > max_validators:
        fail(f"{seal_manager_path}.config.min_validators cannot exceed max_validators")


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

    validate_contract_wiring(contract_by_name)
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
