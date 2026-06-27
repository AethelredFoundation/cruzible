import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadDisasterRecoveryTargets,
  validateDisasterRecoveryTargets,
} from "../../scripts/validate-dr-targets.mjs";

const repoRoot = process.cwd();

describe("disaster recovery target validation", () => {
  it("keeps RTO/RPO and required drill evidence machine-checked", () => {
    const targets = loadDisasterRecoveryTargets();
    const result = validateDisasterRecoveryTargets(targets);

    expect(result.errors).toEqual([]);
    expect(targets.objectives.rto_minutes).toBeLessThanOrEqual(240);
    expect(targets.objectives.rpo_minutes).toBeLessThanOrEqual(60);
    expect(targets.required_drill_evidence).toContain("operator_approvals");
  });

  it("rejects weak recovery targets and missing service evidence", () => {
    const targets = loadDisasterRecoveryTargets();
    const broken = {
      ...targets,
      objectives: {
        ...targets.objectives,
        rto_minutes: 480,
        backup_required_before_migrations: false,
      },
      critical_services: targets.critical_services.filter(
        (service: { name: string }) => service.name !== "postgres",
      ),
      required_drill_evidence: ["commit"],
    };

    const result = validateDisasterRecoveryTargets(broken);

    expect(result.errors).toContain(
      "$.objectives.rto_minutes cannot exceed 240",
    );
    expect(result.errors).toContain(
      "$.objectives.backup_required_before_migrations must be true",
    );
    expect(result.errors).toContain(
      "$.critical_services must include postgres",
    );
    expect(result.errors).toContain(
      "$.required_drill_evidence must include operator_approvals",
    );
  });

  it("is wired into root validation scripts", () => {
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

    expect(packageJson.scripts["readiness:dr"]).toBe(
      "node scripts/validate-dr-targets.mjs",
    );
    expect(packageJson.scripts.validate).toContain("npm run readiness:dr");
    expect(packageJson.scripts["verify:ci"]).toContain("npm run readiness:dr");
    expect(ciWorkflow).toContain("Validate disaster recovery targets");
    expect(ciWorkflow).toContain("npm run readiness:dr");
    expect(securityWorkflow).toContain("Validate disaster recovery targets");
    expect(securityWorkflow).toContain("npm run readiness:dr");
  });
});
