#!/usr/bin/env python3
"""Unit tests for release manifest validation."""

from __future__ import annotations

import copy
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = SCRIPT_DIR.parent
EXAMPLE_MANIFEST = WORKSPACE_DIR / "deployments" / "release-manifest.example.json"


def load_validator_module():
    spec = importlib.util.spec_from_file_location(
        "validate_release_manifest",
        SCRIPT_DIR / "validate-release-manifest.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load validate-release-manifest.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = load_validator_module()


class ReleaseManifestValidationTests(unittest.TestCase):
    def load_example(self) -> dict:
        return json.loads(EXAMPLE_MANIFEST.read_text(encoding="utf-8"))

    def write_manifest(self, directory: Path, manifest: dict) -> Path:
        path = directory / "release-manifest.json"
        path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return path

    def action_by_name(self, manifest: dict, name: str) -> dict:
        return next(action for action in manifest["post_instantiate_actions"] if action["name"] == name)

    def strict_manifest(self) -> dict:
        manifest = self.load_example()
        git_commit = "1234567890abcdef1234567890abcdef12345678"
        manifest["source"]["git_commit"] = git_commit
        manifest["source"]["artifact_manifest"] = f"cosmwasm-contracts-{git_commit}/manifest.json"
        manifest["source"]["checksum_file"] = f"cosmwasm-contracts-{git_commit}/SHA256SUMS"
        manifest["source"]["signatures_file"] = f"cosmwasm-contracts-{git_commit}/signatures.json"
        manifest["operator_signoff"]["notes"] = "Staging deployment evidence reconciled."

        for index, artifact in enumerate(manifest["artifacts"], start=1):
            artifact["upload_tx_hash"] = f"{index:064x}"
        for index, action in enumerate(manifest["post_instantiate_actions"], start=10):
            action["tx_hash"] = f"{index:064x}"
        return manifest

    def write_artifact_dir(self, directory: Path, manifest: dict) -> Path:
        artifact_dir = directory / "audit-artifacts" / "contracts"
        artifact_dir.mkdir(parents=True)
        artifact_entries = [
            {
                "file": artifact["file"],
                "sha256": artifact["sha256"],
                "bytes": artifact["bytes"],
            }
            for artifact in manifest["artifacts"]
        ]
        artifact_manifest = {
            "schema": "cruzible.contract_audit_artifacts.v1",
            "git_commit": manifest["source"]["git_commit"],
            "generated_at": "2026-04-28T00:00:00Z",
            "artifacts": artifact_entries,
        }
        (artifact_dir / "manifest.json").write_text(
            json.dumps(artifact_manifest, indent=2),
            encoding="utf-8",
        )
        (artifact_dir / "SHA256SUMS").write_text(
            "".join(f"{entry['sha256']}  {entry['file']}\n" for entry in artifact_entries),
            encoding="utf-8",
        )
        signatures = {
            "schema": "cruzible.contract_artifact_signatures.v1",
            "generated_at": "2026-04-28T00:00:00Z",
            "signer_id": manifest["source"]["signer_id"],
            "backend": "cosign",
            "entries": [
                {"file": "SHA256SUMS", "signature": "SHA256SUMS.sig"},
                {"file": "manifest.json", "signature": "manifest.json.sig"},
            ],
        }
        (artifact_dir / "signatures.json").write_text(
            json.dumps(signatures, indent=2),
            encoding="utf-8",
        )
        (artifact_dir / "SHA256SUMS.sig").write_text("signature", encoding="utf-8")
        (artifact_dir / "manifest.json.sig").write_text("signature", encoding="utf-8")
        return artifact_dir

    def assert_manifest_fails(self, *args, **kwargs) -> None:
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                validator.validate_manifest(*args, **kwargs)

    def validate_manifest_quietly(self, *args, **kwargs) -> None:
        with contextlib.redirect_stdout(io.StringIO()):
            validator.validate_manifest(*args, **kwargs)

    def test_example_manifest_validates_in_template_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = self.write_manifest(Path(temp_dir), self.load_example())
            self.validate_manifest_quietly(manifest_path)

    def test_strict_manifest_rejects_template_git_commit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest_path = self.write_manifest(Path(temp_dir), self.load_example())
            self.assert_manifest_fails(manifest_path, strict=True)

    def test_strict_manifest_reconciles_signed_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            manifest = self.strict_manifest()
            manifest_path = self.write_manifest(temp_path, manifest)
            artifact_dir = self.write_artifact_dir(temp_path, manifest)

            self.validate_manifest_quietly(manifest_path, strict=True, artifact_dir=artifact_dir)

    def test_cross_contract_wiring_rejects_wrong_staking_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest = self.load_example()
            vault = next(contract for contract in manifest["contracts"] if contract["name"] == "vault")
            vault["config"]["staking_token"] = "aethel1wrongstakingtoken000000000000000000000000"
            manifest_path = self.write_manifest(Path(temp_dir), manifest)

            self.assert_manifest_fails(manifest_path)

    def test_post_instantiate_action_required_for_model_registry_role(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest = self.load_example()
            manifest["post_instantiate_actions"] = [
                action
                for action in manifest["post_instantiate_actions"]
                if action["name"] != "model_registry_set_ai_job_manager"
            ]
            manifest_path = self.write_manifest(Path(temp_dir), manifest)

            self.assert_manifest_fails(manifest_path)

    def test_post_instantiate_action_must_set_ai_job_manager(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest = self.load_example()
            action = self.action_by_name(manifest, "model_registry_set_ai_job_manager")
            action["message"]["update_config"]["ai_job_manager"] = "aethel1wrongjobs00000000000000000000000000000000"
            manifest_path = self.write_manifest(Path(temp_dir), manifest)

            self.assert_manifest_fails(manifest_path)

    def test_post_instantiate_action_required_for_cw20_minter_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest = self.load_example()
            manifest["post_instantiate_actions"] = [
                action
                for action in manifest["post_instantiate_actions"]
                if action["name"] != "cw20_staking_set_vault_minter"
            ]
            manifest_path = self.write_manifest(Path(temp_dir), manifest)

            self.assert_manifest_fails(manifest_path)

    def test_post_instantiate_action_must_set_vault_minter(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest = self.load_example()
            action = self.action_by_name(manifest, "cw20_staking_set_vault_minter")
            action["message"]["update_minter"]["new_minter"] = "aethel1wrongvault0000000000000000000000000000000"
            manifest_path = self.write_manifest(Path(temp_dir), manifest)

            self.assert_manifest_fails(manifest_path)

    def test_artifact_reconciliation_rejects_checksum_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            manifest = self.strict_manifest()
            artifact_dir_manifest = copy.deepcopy(manifest)
            artifact_dir_manifest["artifacts"][0]["sha256"] = "f" * 64
            manifest_path = self.write_manifest(temp_path, manifest)
            artifact_dir = self.write_artifact_dir(temp_path, artifact_dir_manifest)

            self.assert_manifest_fails(manifest_path, strict=True, artifact_dir=artifact_dir)

    def test_artifact_reconciliation_requires_detached_signatures(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            manifest = self.strict_manifest()
            manifest_path = self.write_manifest(temp_path, manifest)
            artifact_dir = self.write_artifact_dir(temp_path, manifest)
            (artifact_dir / "manifest.json.sig").unlink()

            self.assert_manifest_fails(manifest_path, strict=True, artifact_dir=artifact_dir)


if __name__ == "__main__":
    unittest.main()
