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
    expect(errors).toEqual([]);
  });

  it("flags high-risk staking and readiness claims", () => {
    const findings = scanTextForLaunchClaims(
      "src/pages/vault/index.tsx",
      [
        "Cruzible is production ready for all users.",
        "Stake with guaranteed APY.",
        "This is a risk-free liquid staking app.",
        "Cruzible is tier 1 audited.",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.rule)).toEqual([
      "CLAIM-PRODUCTION-READY",
      "CLAIM-GUARANTEED-YIELD",
      "CLAIM-RISK-FREE",
      "CLAIM-AUDITED",
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
