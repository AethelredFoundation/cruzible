import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildReleaseSbom,
  collectReleaseComponents,
} from "../../scripts/generate-release-sbom.mjs";

type SbomPackage = {
  name: string;
  comment: string;
};

type ReleaseComponent = {
  ecosystem: string;
  kind: string;
  integrity?: string;
  checksum?: string;
};

describe("release SBOM", () => {
  it("generates a valid multi-ecosystem SPDX document from checked-in locks", () => {
    const { document, validation } = buildReleaseSbom();
    const packages = document.packages as SbomPackage[];

    expect(validation.errors).toEqual([]);
    expect(validation.componentCount).toBeGreaterThan(100);
    expect(validation.scopeCounts).toMatchObject({
      frontend: expect.any(Number),
      api: expect.any(Number),
      "typescript-sdk": expect.any(Number),
      contracts: expect.any(Number),
    });
    expect(document.spdxVersion).toBe("SPDX-2.3");
    expect(document.documentDescribes).toHaveLength(4);
    expect(document.relationships.length).toBeGreaterThan(
      document.documentDescribes.length,
    );
    expect(
      packages.some(
        (pkg) =>
          pkg.name === "@aethelred/cruzible" &&
          pkg.comment.includes("scope=frontend"),
      ),
    ).toBe(true);
    expect(
      packages.some(
        (pkg) =>
          pkg.name === "cruzible-contracts-workspace" &&
          pkg.comment.includes("scope=contracts"),
      ),
    ).toBe(true);
  });

  it("keeps dependency checksums and integrity evidence in the SBOM", () => {
    const components = collectReleaseComponents() as ReleaseComponent[];

    expect(
      components.some(
        (component) =>
          component.ecosystem === "npm" &&
          component.kind === "dependency" &&
          typeof component.integrity === "string" &&
          component.integrity.startsWith("sha"),
      ),
    ).toBe(true);
    expect(
      components.some(
        (component) =>
          component.ecosystem === "cargo" &&
          component.kind === "dependency" &&
          typeof component.checksum === "string" &&
          component.checksum.length >= 32,
      ),
    ).toBe(true);
  });

  it("exposes a CI-safe validation command", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/generate-release-sbom.mjs", "--check"],
      {
        encoding: "utf8",
      },
    );

    expect(output).toContain("Release SBOM validation passed");
    expect(output).toContain("frontend=");
    expect(output).toContain("api=");
    expect(output).toContain("typescript-sdk=");
    expect(output).toContain("contracts=");
  });

  it("writes explicitly requested absolute output paths outside the repo", () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), "cruzible-sbom-"));
    const outputPath = join(tempDirectory, "release.spdx.json");

    try {
      execFileSync(
        process.execPath,
        ["scripts/generate-release-sbom.mjs", "--output", outputPath],
        {
          encoding: "utf8",
        },
      );

      expect(existsSync(outputPath)).toBe(true);
      expect(existsSync("private/tmp/release.spdx.json")).toBe(false);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
