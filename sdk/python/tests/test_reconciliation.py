from __future__ import annotations

import json
import pathlib
import unittest
from unittest.mock import patch

from cruzible_sdk.reconciliation import (
    fetch_reconciliation_input,
    load_reconciliation_input,
    reconcile_epoch_document,
    render_markdown_report,
)
from cruzible_sdk.payloads import (
    bytes_to_hex,
    compute_canonical_delegation_payload,
    compute_delegation_registry_root,
    compute_eligible_universe_hash,
    compute_stake_snapshot_hash,
    compute_staker_registry_root,
    delegation_input_from_mapping,
    staker_from_mapping,
)


ROOT = pathlib.Path(__file__).resolve().parents[3]


class ReconciliationTests(unittest.TestCase):
    def test_reconciliation_fixture_passes(self) -> None:
        fixture = load_reconciliation_input(
            ROOT / "test-vectors" / "reconciliation" / "default.json"
        )
        report = reconcile_epoch_document(fixture)

        self.assertTrue(report["summary"]["ok"])
        self.assertEqual(report["summary"]["failed_checks"], 0)
        self.assertEqual(report["summary"]["passed_checks"], report["summary"]["total_checks"])

        markdown = render_markdown_report(report)
        self.assertIn("# Cruzible Epoch Reconciliation", markdown)
        self.assertIn("`PASS`", markdown)

    def test_reconciliation_detects_modified_observed_value(self) -> None:
        fixture_path = ROOT / "test-vectors" / "reconciliation" / "default.json"
        fixture = json.loads(fixture_path.read_text())
        fixture["observed"]["reward_calculation"]["delegation_registry_root"] = "0x" + "00" * 32

        report = reconcile_epoch_document(fixture)

        self.assertFalse(report["summary"]["ok"])
        self.assertIn("delegation_registry_root", report["failed_checks"])

    def test_partial_live_document_reconciles_available_sections(self) -> None:
        staker_mappings = [
            {
                "address": "0x1111111111111111111111111111111111111111",
                "shares": "1000",
                "delegated_to": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            {
                "address": "0x2222222222222222222222222222222222222222",
                "shares": "2500",
                "delegated_to": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
        ]
        stakers = [staker_from_mapping(item) for item in staker_mappings]
        stake_snapshot_hash = bytes_to_hex(compute_stake_snapshot_hash(42, stakers))
        staker_registry_root = bytes_to_hex(compute_staker_registry_root(stakers))
        delegation_registry_root = bytes_to_hex(compute_delegation_registry_root(stakers))
        delegation_payload_hex = bytes_to_hex(
            compute_canonical_delegation_payload(
                delegation_input_from_mapping(
                    {
                    "epoch": 42,
                    "delegation_root": delegation_registry_root,
                    "staker_registry_root": staker_registry_root,
                    }
                )
            )
        )
        document = {
            "epoch": 42,
            "network": "aethelred",
            "mode": "live-snapshot",
            "warnings": ["example live warning"],
            "validator_selection": {
                "input": {
                    "eligible_addresses": ["aethelvaloper1abc", "aethelvaloper1def"],
                },
                "observed": {
                    "universe_hash": bytes_to_hex(
                        compute_eligible_universe_hash(
                            ["aethelvaloper1abc", "aethelvaloper1def"]
                        )
                    )
                },
            },
            "stake_snapshot": {
                "input": {
                    "stakers": staker_mappings,
                },
                "observed": {
                    "stake_snapshot_hash": stake_snapshot_hash,
                    "staker_registry_root": staker_registry_root,
                    "delegation_registry_root": delegation_registry_root,
                    "delegation_payload_hex": delegation_payload_hex,
                },
            },
        }

        report = reconcile_epoch_document(document)

        self.assertTrue(report["summary"]["ok"])
        self.assertEqual(report["summary"]["total_checks"], 5)
        self.assertEqual(report["mode"], "live-snapshot")
        self.assertEqual(report["warnings"], ["example live warning"])
        self.assertIn("stake_snapshot", report["computed"])

    def test_fetch_reconciliation_input_over_http(self) -> None:
        fixture_path = ROOT / "test-vectors" / "reconciliation" / "default.json"
        payload = fixture_path.read_text().encode("utf-8")
        expected = json.loads(fixture_path.read_text())

        class _FakeResponse:
            def __enter__(self) -> "_FakeResponse":
                return self

            def __exit__(self, exc_type, exc, tb) -> None:
                return None

            def read(self) -> bytes:
                return payload

        with patch("cruzible_sdk.reconciliation.urlopen", return_value=_FakeResponse()):
            document = fetch_reconciliation_input(
                "http://127.0.0.1:3001/v1/reconciliation/live",
                timeout=5.0,
            )

        self.assertEqual(document["epoch"], expected["epoch"])
        self.assertIn("validator_selection", document)


if __name__ == "__main__":
    unittest.main()
