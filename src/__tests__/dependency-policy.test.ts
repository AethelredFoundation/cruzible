import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateDependencyPolicy } from "../../scripts/validate-dependency-policy.mjs";

const packageManager = "npm@10.9.4";
const engines = {
  node: ">=20.0.0",
  npm: ">=10.0.0",
};

function writeJson(root: string, filePath: string, value: unknown) {
  const absolutePath = join(root, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root: string, filePath: string, value: string) {
  const absolutePath = join(root, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value);
}

function withFixture<T>(
  files: Record<string, unknown>,
  callback: (root: string) => T,
) {
  const root = mkdtempSync(join(tmpdir(), "cruzible-deps-"));

  try {
    for (const [filePath, value] of Object.entries(files)) {
      writeJson(root, filePath, value);
    }

    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "fixture",
    version: "1.0.0",
    private: true,
    packageManager,
    engines,
    dependencies: {
      zod: "^3.25.76",
    },
    ...overrides,
  };
}

function lock(rootPackage: Record<string, unknown> = {}) {
  return {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "fixture",
        version: "1.0.0",
        dependencies: {
          zod: "^3.25.76",
        },
        engines,
        ...rootPackage,
      },
      "node_modules/zod": {
        version: "3.25.76",
        resolved: "https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
        integrity: "sha512-fixture",
        license: "MIT",
      },
    },
  };
}

describe("dependency policy validation", () => {
  it("passes for the repository dependency manifests and lockfiles", () => {
    const result = validateDependencyPolicy();

    expect(result.errors).toEqual([]);
    expect(new Set(result.projects)).toEqual(
      new Set(["backend/api", "sdk/typescript", "."]),
    );
    expect(result.cargoManifests).toContain("backend/contracts/Cargo.toml");
    expect(result.cargoManifests).not.toContain("backend/node/Cargo.toml");
  });

  it("rejects mutable package sources and missing package manager metadata", () => {
    const result = withFixture(
      {
        "package.json": manifest({
          dependencies: {
            zod: "github:colinhacks/zod",
          },
          packageManager: undefined,
        }),
        "package-lock.json": lock({
          dependencies: {
            zod: "github:colinhacks/zod",
          },
        }),
      },
      validateDependencyPolicy,
    );

    expect(result.errors.join("\n")).toContain(
      "packageManager must be npm@10.9.4",
    );
    expect(result.errors.join("\n")).toContain(
      "dependencies.zod uses disallowed non-registry specifier github:colinhacks/zod",
    );
  });

  it("rejects lockfiles without registry tarballs and sha512 integrity", () => {
    const result = withFixture(
      {
        "package.json": manifest(),
        "package-lock.json": lock(),
      },
      (root) => {
        const packageLock = lock();
        packageLock.packages["node_modules/zod"].resolved =
          "https://example.invalid/zod.tgz";
        packageLock.packages["node_modules/zod"].integrity = "sha1-fixture";
        writeJson(root, "package-lock.json", packageLock);

        return validateDependencyPolicy(root);
      },
    );

    expect(result.errors.join("\n")).toContain(
      "node_modules/zod must resolve from https://registry.npmjs.org/",
    );
    expect(result.errors.join("\n")).toContain(
      "node_modules/zod must have sha512 integrity",
    );
  });

  it("rejects manifest and lockfile dependency drift", () => {
    const result = withFixture(
      {
        "package.json": manifest({
          dependencies: {
            zod: "^3.25.76",
          },
        }),
        "package-lock.json": lock({
          dependencies: {
            zod: "^3.20.0",
          },
        }),
      },
      validateDependencyPolicy,
    );

    expect(result.errors.join("\n")).toContain(
      'manifest dependencies is not synchronized with package-lock.json packages[""] metadata',
    );
  });

  it("rejects production Cargo manifests without lock coverage or with git dependencies", () => {
    const result = withFixture(
      {
        "package.json": manifest(),
        "package-lock.json": lock(),
      },
      (root) => {
        writeText(
          root,
          "backend/contracts/Cargo.toml",
          '[package]\nname = "contracts"\nversion = "0.1.0"\n[dependencies]\nserde = { git = "https://example.invalid/serde" }\n',
        );

        return validateDependencyPolicy(root);
      },
    );

    expect(result.errors.join("\n")).toContain(
      "backend/contracts/Cargo.toml: Cargo manifest must be covered by a committed Cargo.lock",
    );
    expect(result.errors.join("\n")).toContain(
      "backend/contracts/Cargo.toml: production Cargo manifests must not depend on git sources",
    );
  });

  it("rejects reintroducing a node scaffold across the external chain boundary", () => {
    const result = withFixture(
      {
        "package.json": manifest(),
        "package-lock.json": lock(),
      },
      (root) => {
        writeText(
          root,
          "backend/node/Cargo.toml",
          '[package]\nname = "node-scaffold"\nversion = "0.1.0"\n',
        );

        return validateDependencyPolicy(root);
      },
    );

    expect(result.errors.join("\n")).toContain(
      "backend/node: the canonical Aethelred node belongs in https://github.com/aethelred-foundation/aethelred, not in the Cruzible release",
    );
  });
});
