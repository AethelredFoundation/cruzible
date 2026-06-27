import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDisasterRecoveryTargets } from "../../scripts/validate-dr-targets.mjs";
import {
  loadRestoreDrillEvidence,
  validateRestoreDrillEvidence,
} from "../../scripts/validate-restore-drill-evidence.mjs";

const repoRoot = process.cwd();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("restore drill evidence validation", () => {
  it("accepts the repository evidence contract example", () => {
    const targets = loadDisasterRecoveryTargets();
    const evidence = loadRestoreDrillEvidence();
    const result = validateRestoreDrillEvidence(evidence, targets);

    expect(result.errors).toEqual([]);
    expect(evidence.rto_actual_minutes).toBeLessThanOrEqual(
      targets.objectives.rto_minutes,
    );
    expect(evidence.rpo_actual_minutes).toBeLessThanOrEqual(
      targets.objectives.rpo_minutes,
    );
  });

  it("rejects weak or unverifiable restore evidence", () => {
    const targets = loadDisasterRecoveryTargets();
    const evidence = clone(loadRestoreDrillEvidence());

    evidence.rto_actual_minutes = targets.objectives.rto_minutes + 1;
    evidence.database_backup_manifest.dry_run = true;
    evidence.database_backup_manifest.backup.sha256 = "not-a-digest";
    evidence.database_backup_manifest.verification.status = "pending";
    evidence.readiness_probe_result.status = "failed";
    evidence.operator_approvals = [evidence.operator_approvals[0]];

    const result = validateRestoreDrillEvidence(evidence, targets);

    expect(result.errors).toContain(
      `$.rto_actual_minutes exceeds target ${targets.objectives.rto_minutes}`,
    );
    expect(result.errors).toContain(
      "$.database_backup_manifest.dry_run must be false",
    );
    expect(result.errors).toContain(
      "$.database_backup_manifest.backup.sha256 must be a 64-character hex digest",
    );
    expect(result.errors).toContain(
      "$.database_backup_manifest.verification.status must be passed",
    );
    expect(result.errors).toContain(
      "$.readiness_probe_result.status must be passed or ready",
    );
    expect(result.errors).toContain(
      "$.operator_approvals must contain at least 2 approvals",
    );
  });

  it("is wired into root readiness and security workflows", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const ciWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/ci-cd.yml"),
      "utf8",
    );
    const securityWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/security-audit.yml"),
      "utf8",
    );

    expect(packageJson.scripts["readiness:restore-drill"]).toBe(
      "node scripts/validate-restore-drill-evidence.mjs",
    );
    expect(packageJson.scripts.validate).toContain(
      "npm run readiness:restore-drill",
    );
    expect(packageJson.scripts["verify:ci"]).toContain(
      "npm run readiness:restore-drill",
    );
    expect(ciWorkflow).toContain("Validate restore drill evidence contract");
    expect(ciWorkflow).toContain("npm run readiness:restore-drill");
    expect(securityWorkflow).toContain(
      "Validate restore drill evidence contract",
    );
    expect(securityWorkflow).toContain("npm run readiness:restore-drill");
  });
});
