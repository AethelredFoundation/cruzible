import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadDependencyAdvisoryRegister,
  validateDependencyAdvisoryResolution,
  versionSatisfiesRange,
} from "../../scripts/validate-dependency-advisories.mjs";

const validateResolution = validateDependencyAdvisoryResolution as (options: {
  register?: unknown;
  root?: string;
}) => {
  alertCount: number;
  checkedVersions: number;
  errors: string[];
  groupCount: number;
};

function writeFixture(root: string, files: Record<string, string>) {
  for (const [filePath, source] of Object.entries(files)) {
    const absolutePath = join(root, filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source);
  }
}

function minimalRegister() {
  return {
    schema: "cruzible.dependency_advisory_register.v1",
    source: {
      alert_count: 1,
    },
    groups: [
      {
        manifest_path: "package-lock.json",
        ecosystem: "npm",
        package_name: "axios",
        alert_count: 1,
        max_severity: "high",
        vulnerable_ranges: [">= 1.0.0, < 1.16.0"],
        first_patched_versions: ["1.16.0"],
        advisory_ids: ["GHSA-test"],
      },
    ],
  };
}

describe("dependency advisory remediation validation", () => {
  it("covers the captured default-branch advisory set against current locks", () => {
    const register = loadDependencyAdvisoryRegister();
    const result = validateResolution({ register });

    expect(result.alertCount).toBe(105);
    expect(result.groupCount).toBe(24);
    expect(result.checkedVersions).toBeGreaterThan(20);
    expect(result.errors).toEqual([]);
  });

  it("matches GitHub-style vulnerable ranges", () => {
    expect(versionSatisfiesRange("1.15.2", ">= 1.0.0, < 1.16.0")).toBe(true);
    expect(versionSatisfiesRange("1.16.0", ">= 1.0.0, < 1.16.0")).toBe(false);
    expect(versionSatisfiesRange("4.12.11", ">= 4.0.0, <= 4.12.11")).toBe(true);
  });

  it("rejects vulnerable package-lock resolutions", () => {
    const root = mkdtempSync(join(tmpdir(), "cruzible-advisory-"));

    try {
      writeFixture(root, {
        "package-lock.json": JSON.stringify(
          {
            lockfileVersion: 3,
            packages: {
              "node_modules/axios": {
                version: "1.15.2",
              },
            },
          },
          null,
          2,
        ),
      });

      const result = validateResolution({
        register: minimalRegister(),
        root,
      });

      expect(result.errors).toEqual([
        "package-lock.json: axios@1.15.2 from node_modules/axios still satisfies vulnerable range >= 1.0.0, < 1.16.0",
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("treats package removal as resolved", () => {
    const root = mkdtempSync(join(tmpdir(), "cruzible-advisory-"));

    try {
      writeFixture(root, {
        "package-lock.json": JSON.stringify(
          {
            lockfileVersion: 3,
            packages: {},
          },
          null,
          2,
        ),
      });

      const result = validateResolution({
        register: minimalRegister(),
        root,
      });

      expect(result.errors).toEqual([]);
      expect(result.checkedVersions).toBe(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
