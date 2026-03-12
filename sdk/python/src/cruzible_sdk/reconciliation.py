from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen

from .payloads import (
    bytes_to_hex,
    compute_canonical_delegation_payload,
    compute_canonical_reward_payload,
    compute_canonical_validator_payload,
    compute_delegation_registry_root,
    compute_eligible_universe_hash,
    compute_selection_policy_hash,
    compute_stake_snapshot_hash,
    compute_staker_registry_root,
    compute_validator_set_hash,
    delegation_input_from_mapping,
    reward_input_from_mapping,
    selection_config_from_mapping,
    staker_from_mapping,
    validator_from_mapping,
)


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    computed: str
    observed: str
    description: str


def load_reconciliation_input(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def fetch_reconciliation_input(url: str, timeout: float = 10.0) -> dict[str, Any]:
    with urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def reconcile_epoch_document(document: dict[str, Any]) -> dict[str, Any]:
    checks: list[CheckResult] = []
    computed: dict[str, Any] = {}
    epoch = document["epoch"]
    network = document.get("network", "unknown")
    warnings = list(document.get("warnings", []))

    _reconcile_validator_selection(document, epoch, computed, checks)
    _reconcile_stake_snapshot(document, epoch, computed, checks)
    _reconcile_reward_payload(document, epoch, computed, checks)

    if not checks:
        raise ValueError("document does not contain any reconcilable sections")

    passed_checks = sum(1 for check in checks if check.ok)
    failed_checks = [check.name for check in checks if not check.ok]

    return {
        "epoch": epoch,
        "network": network,
        "mode": document.get("mode", "fixture"),
        "source": document.get("source"),
        "warnings": warnings,
        "summary": {
            "total_checks": len(checks),
            "passed_checks": passed_checks,
            "failed_checks": len(failed_checks),
            "ok": len(failed_checks) == 0,
        },
        "computed": computed,
        "checks": [
            {
                "name": check.name,
                "ok": check.ok,
                "computed": check.computed,
                "observed": check.observed,
                "description": check.description,
            }
            for check in checks
        ],
        "failed_checks": failed_checks,
    }


def render_markdown_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# Cruzible Epoch Reconciliation",
        "",
        f"- Epoch: `{report['epoch']}`",
        f"- Network: `{report['network']}`",
        f"- Mode: `{report.get('mode', 'unknown')}`",
        f"- Result: `{'PASS' if summary['ok'] else 'FAIL'}`",
        f"- Checks passed: `{summary['passed_checks']}/{summary['total_checks']}`",
        "",
    ]

    source = report.get("source")
    if source:
        lines.extend(
            [
                "## Source",
                "",
                *(
                    f"- `{key}`: `{value}`"
                    for key, value in sorted(source.items(), key=lambda item: item[0])
                ),
                "",
            ]
        )

    warnings = report.get("warnings", [])
    if warnings:
        lines.extend(
            [
                "## Warnings",
                "",
                *(f"- {warning}" for warning in warnings),
                "",
            ]
        )

    lines.extend(
        [
            "## Checks",
        ]
    )

    for check in report["checks"]:
        status = "PASS" if check["ok"] else "FAIL"
        lines.extend(
            [
                f"- `{status}` `{check['name']}`",
                f"  - Description: {check['description']}",
                f"  - Computed: `{check['computed']}`",
                f"  - Observed: `{check['observed']}`",
            ]
        )

    if report["failed_checks"]:
        lines.extend(
            [
                "",
                "## Failed Checks",
                *(f"- `{name}`" for name in report["failed_checks"]),
            ]
        )

    return "\n".join(lines) + "\n"


def _check(name: str, computed: str, observed: str, description: str) -> CheckResult:
    return CheckResult(
        name=name,
        ok=computed.lower() == observed.lower(),
        computed=computed,
        observed=observed,
        description=description,
    )


def _reconcile_validator_selection(
    document: dict[str, Any],
    epoch: int,
    computed: dict[str, Any],
    checks: list[CheckResult],
) -> None:
    section = document.get("validator_selection")
    if not isinstance(section, dict):
        return

    section_input = section.get("input", {})
    observed = _get_observed_section(document, "validator_selection")
    section_computed: dict[str, str] = {}

    eligible_addresses = section_input.get("eligible_addresses")
    if isinstance(eligible_addresses, list):
        universe_hash = bytes_to_hex(compute_eligible_universe_hash(eligible_addresses))
        section_computed["universe_hash"] = universe_hash
        _append_check_if_present(
            checks,
            observed,
            "universe_hash",
            universe_hash,
            "Eligible validator universe hash",
        )

    validators = section_input.get("validators")
    config_mapping = section_input.get("config")
    if isinstance(validators, list) and isinstance(config_mapping, dict):
        validator_items = [validator_from_mapping(item) for item in validators]
        config = selection_config_from_mapping(config_mapping)
        validator_set_hash = bytes_to_hex(compute_validator_set_hash(epoch, validator_items))
        policy_hash = bytes_to_hex(compute_selection_policy_hash(config))
        section_computed["validator_set_hash"] = validator_set_hash
        section_computed["policy_hash"] = policy_hash

        _append_check_if_present(
            checks,
            observed,
            "validator_set_hash",
            validator_set_hash,
            "Canonical validator set hash derived from scored validators",
        )
        _append_check_if_present(
            checks,
            observed,
            "policy_hash",
            policy_hash,
            "Selection policy hash derived from configured weights and thresholds",
        )

        if isinstance(eligible_addresses, list):
            validator_payload_hex = bytes_to_hex(
                compute_canonical_validator_payload(
                    epoch,
                    validator_items,
                    config,
                    eligible_addresses,
                )
            )
            section_computed["payload_hex"] = validator_payload_hex
            _append_check_if_present(
                checks,
                observed,
                "payload_hex",
                validator_payload_hex,
                "96-byte validator attestation payload",
            )

    if section_computed:
        computed["validator_selection"] = section_computed


def _reconcile_stake_snapshot(
    document: dict[str, Any],
    epoch: int,
    computed: dict[str, Any],
    checks: list[CheckResult],
) -> None:
    if isinstance(document.get("stake_snapshot"), dict):
        section_name = "stake_snapshot"
        section = document["stake_snapshot"]
        staker_items = section.get("input", {}).get("stakers")
    elif isinstance(document.get("reward_calculation"), dict):
        section_name = "reward_calculation"
        section = document["reward_calculation"]
        staker_items = section.get("input", {}).get("staker_stakes")
    else:
        return

    if not isinstance(staker_items, list):
        return

    stakers = [staker_from_mapping(item) for item in staker_items]
    observed = _get_observed_section(document, section_name)
    section_computed = computed.setdefault(section_name, {})
    stake_snapshot_hash = bytes_to_hex(compute_stake_snapshot_hash(epoch, stakers))
    section_computed["stake_snapshot_hash"] = stake_snapshot_hash

    _append_check_if_present(
        checks,
        observed,
        "stake_snapshot_hash",
        stake_snapshot_hash,
        "Canonical epoch stake snapshot hash",
    )

    needs_registry_roots = any(
        key in observed
        for key in ("staker_registry_root", "delegation_registry_root", "delegation_payload_hex")
    )
    if not needs_registry_roots:
        return

    staker_registry_root = bytes_to_hex(compute_staker_registry_root(stakers))
    delegation_registry_root = bytes_to_hex(compute_delegation_registry_root(stakers))
    section_computed["staker_registry_root"] = staker_registry_root
    section_computed["delegation_registry_root"] = delegation_registry_root

    _append_check_if_present(
        checks,
        observed,
        "staker_registry_root",
        staker_registry_root,
        "Keccak/XOR registry root for staker shares",
    )
    _append_check_if_present(
        checks,
        observed,
        "delegation_registry_root",
        delegation_registry_root,
        "Keccak/XOR registry root for delegation topology",
    )

    if "delegation_payload_hex" in observed:
        delegation_payload_hex = bytes_to_hex(
            compute_canonical_delegation_payload(
                delegation_input_from_mapping(
                    {
                        "epoch": epoch,
                        "delegation_root": delegation_registry_root,
                        "staker_registry_root": staker_registry_root,
                    }
                )
            )
        )
        section_computed["delegation_payload_hex"] = delegation_payload_hex
        _append_check_if_present(
            checks,
            observed,
            "delegation_payload_hex",
            delegation_payload_hex,
            "96-byte delegation attestation payload",
        )


def _reconcile_reward_payload(
    document: dict[str, Any],
    epoch: int,
    computed: dict[str, Any],
    checks: list[CheckResult],
) -> None:
    section = document.get("reward_calculation")
    if not isinstance(section, dict):
        return

    reward_input = section.get("input", {})
    observed = _get_observed_section(document, "reward_calculation")
    if not isinstance(reward_input, dict) or "payload_hex" not in observed:
        return

    required_fields = {"total_rewards", "merkle_root", "protocol_fee", "validator_set_hash"}
    if not required_fields.issubset(reward_input.keys()):
        return

    section_computed = computed.setdefault("reward_calculation", {})
    staker_items = reward_input.get("staker_stakes", [])
    if not isinstance(staker_items, list):
        return

    stakers = [staker_from_mapping(item) for item in staker_items]
    stake_snapshot_hash = section_computed.get("stake_snapshot_hash") or bytes_to_hex(
        compute_stake_snapshot_hash(epoch, stakers)
    )
    staker_registry_root = section_computed.get("staker_registry_root") or bytes_to_hex(
        compute_staker_registry_root(stakers)
    )
    delegation_registry_root = section_computed.get("delegation_registry_root") or bytes_to_hex(
        compute_delegation_registry_root(stakers)
    )

    reward_payload_hex = bytes_to_hex(
        compute_canonical_reward_payload(
            reward_input_from_mapping(
                {
                    "epoch": epoch,
                    "total_rewards": reward_input["total_rewards"],
                    "merkle_root": reward_input["merkle_root"],
                    "protocol_fee": reward_input["protocol_fee"],
                    "stake_snapshot_hash": stake_snapshot_hash,
                    "validator_set_hash": reward_input["validator_set_hash"],
                    "staker_registry_root": staker_registry_root,
                    "delegation_registry_root": delegation_registry_root,
                }
            )
        )
    )
    section_computed["payload_hex"] = reward_payload_hex
    _append_check_if_present(
        checks,
        observed,
        "payload_hex",
        reward_payload_hex,
        "256-byte reward attestation payload",
    )


def _get_observed_section(document: dict[str, Any], section_name: str) -> dict[str, Any]:
    section = document.get(section_name)
    if isinstance(section, dict) and isinstance(section.get("observed"), dict):
        return section["observed"]
    observed = document.get("observed", {})
    if isinstance(observed, dict) and isinstance(observed.get(section_name), dict):
        return observed[section_name]
    return {}


def _append_check_if_present(
    checks: list[CheckResult],
    observed: dict[str, Any],
    field_name: str,
    computed_value: str,
    description: str,
) -> None:
    observed_value = observed.get(field_name)
    if isinstance(observed_value, str):
        checks.append(_check(field_name, computed_value, observed_value, description))


def is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
