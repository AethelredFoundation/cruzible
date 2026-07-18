import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  scanTextForLaunchClaims,
  validateLaunchClaims,
} from "../../scripts/validate-launch-claims.mjs";

const repoRoot = process.cwd();

describe("launch claim validation", () => {
  it("keeps unsupported financial and production claims out of public copy", () => {
    const { errors, files } = validateLaunchClaims();

    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("backend/contracts/TEST_SUMMARY.md");
    expect(errors).toEqual([]);
  });

  it("flags high-risk staking and readiness claims", () => {
    const findings = scanTextForLaunchClaims(
      "src/pages/vault/index.tsx",
      [
        "Cruzible is production ready for all users.",
        "Cruzible is ready for deployment.",
        "Stake with guaranteed APY.",
        "This is a risk-free liquid staking app.",
        "Cruzible is tier 1 audited.",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.rule)).toEqual([
      "CLAIM-PRODUCTION-READY",
      "CLAIM-DEPLOYMENT-READY",
      "CLAIM-GUARANTEED-YIELD",
      "CLAIM-RISK-FREE",
      "CLAIM-AUDITED",
    ]);
  });

  it("flags contract documentation overclaims", () => {
    const findings = scanTextForLaunchClaims(
      "backend/contracts/TEST_SUMMARY.md",
      [
        "Test Coverage Status: PRODUCTION READY.",
        "Critical contracts have 100% execution path coverage.",
        "All contracts are ready for deployment.",
        "The verifier provides hardware-verified assurance.",
        "This is proof-backed contract evidence.",
        "Complete Job validates TEE attestation verification.",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.rule)).toEqual([
      "CLAIM-PRODUCTION-READY",
      "CLAIM-ABSOLUTE-COVERAGE",
      "CLAIM-DEPLOYMENT-READY",
      "CLAIM-UNBACKED-TEE-PROOF",
      "CLAIM-UNBACKED-TEE-PROOF",
      "CLAIM-UNBACKED-TEE-PROOF",
    ]);
  });

  it("blocks unsupported TEE assurance in public product copy", () => {
    const findings = scanTextForLaunchClaims(
      "src/pages/vault/index.tsx",
      "The vault labels a source as hardware-verified.",
    );

    expect(findings.map((finding) => finding.rule)).toEqual([
      "CLAIM-UNBACKED-TEE-PROOF",
    ]);
  });

  it("allows defensive disclosure language that avoids overclaiming", () => {
    const findings = scanTextForLaunchClaims(
      "src/pages/vault/index.tsx",
      [
        "Cruzible is not production ready until external audit evidence exists.",
        "Instant exits are not guaranteed.",
        "This is not a risk-free product.",
        "The contracts are not audited yet.",
        "Block unsupported production-ready, mainnet-ready, and risk-free claims.",
        "This document does not support a production-ready or mainnet-ready designation.",
        "This document should not be read as a 100% coverage claim.",
        "The contracts are not ready for deployment.",
      ].join("\n"),
    );

    expect(findings).toEqual([]);
  });

  it("is wired into the root validation scripts", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["readiness:claims"]).toBe(
      "node scripts/validate-launch-claims.mjs",
    );
    expect(packageJson.scripts.validate).toContain("npm run readiness:claims");
    expect(packageJson.scripts["verify:ci"]).toContain(
      "npm run readiness:claims",
    );
  });
});
