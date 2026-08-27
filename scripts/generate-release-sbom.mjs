#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_OUTPUT_PATH = ".release-evidence/cruzible-release-sbom.spdx.json";
const REQUIRED_SCOPES = ["frontend", "api", "typescript-sdk", "contracts"];
const MINIMUM_COMPONENT_COUNT = 100;

const NPM_LOCKFILES = [
  {
    scope: "frontend",
    lockfilePath: "package-lock.json",
    packageJsonPath: "package.json",
  },
  {
    scope: "api",
    lockfilePath: "backend/api/package-lock.json",
    packageJsonPath: "backend/api/package.json",
  },
  {
    scope: "typescript-sdk",
    lockfilePath: "sdk/typescript/package-lock.json",
    packageJsonPath: "sdk/typescript/package.json",
  },
];

const CARGO_LOCKFILES = [
  {
    scope: "contracts",
    lockfilePath: "backend/contracts/Cargo.lock",
    packageJsonPath: undefined,
  },
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function gitValue(args, fallback = "unknown") {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

function sourceDateIso() {
  if (process.env.SOURCE_DATE_EPOCH) {
    const epochSeconds = Number(process.env.SOURCE_DATE_EPOCH);
    if (Number.isFinite(epochSeconds) && epochSeconds >= 0) {
      return new Date(epochSeconds * 1000).toISOString();
    }
  }

  const committedAt = gitValue(["show", "-s", "--format=%cI", "HEAD"], "");
  if (committedAt) {
    return new Date(committedAt).toISOString();
  }

  return "1970-01-01T00:00:00.000Z";
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "NOASSERTION";
}

function packageNameFromLockPath(lockPath, metadata) {
  if (typeof metadata.name === "string" && metadata.name.trim()) {
    return metadata.name.trim();
  }

  const nodeModulesSegments = lockPath.split("node_modules/");
  const packagePath = nodeModulesSegments[nodeModulesSegments.length - 1] ?? "";
  if (packagePath.startsWith("@")) {
    return packagePath.split("/").slice(0, 2).join("/");
  }

  return packagePath.split("/")[0];
}

function purlName(name) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    return `${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
  }

  return encodeURIComponent(name);
}

function npmPurl(component) {
  return `pkg:npm/${purlName(component.name)}@${encodeURIComponent(
    component.version,
  )}`;
}

function cargoPurl(component) {
  return `pkg:cargo/${encodeURIComponent(component.name)}@${encodeURIComponent(
    component.version,
  )}`;
}

function parseNpmLockfile(entry) {
  const lock = readJson(entry.lockfilePath);
  const packageJson = readJson(entry.packageJsonPath);
  const components = [
    {
      ecosystem: "npm",
      scope: entry.scope,
      kind: "first-party",
      manifestPath: entry.packageJsonPath,
      lockfilePath: entry.lockfilePath,
      name: packageJson.name ?? lock.name,
      version: packageJson.version ?? lock.version ?? "0.0.0",
      license: normalizeLicense(packageJson.license),
      dependencyType: "application",
      downloadLocation: "NONE",
    },
  ];

  const packages = lock.packages ?? {};
  for (const lockPath of Object.keys(packages).sort()) {
    if (!lockPath) {
      continue;
    }

    const metadata = packages[lockPath] ?? {};
    if (metadata.link === true || typeof metadata.version !== "string") {
      continue;
    }

    const name = packageNameFromLockPath(lockPath, metadata);
    if (!name) {
      continue;
    }

    components.push({
      ecosystem: "npm",
      scope: entry.scope,
      kind: "dependency",
      manifestPath: entry.packageJsonPath,
      lockfilePath: entry.lockfilePath,
      packagePath: lockPath,
      name,
      version: metadata.version,
      license: normalizeLicense(metadata.license),
      dependencyType: metadata.dev ? "development" : "runtime",
      optional: metadata.optional === true,
      resolved: metadata.resolved,
      integrity: metadata.integrity,
      downloadLocation: metadata.resolved ?? "NOASSERTION",
    });
  }

  return components;
}

function parseCargoPackageBlocks(lockfileText) {
  const blocks = [];
  let current;

  for (const rawLine of lockfileText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "[[package]]") {
      if (current) {
        blocks.push(current);
      }
      current = {};
      continue;
    }

    if (!current) {
      continue;
    }

    const property = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"$/);
    if (property) {
      current[property[1]] = property[2];
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function parseCargoLockfile(entry) {
  const components = [
    {
      ecosystem: "cargo",
      scope: entry.scope,
      kind: "first-party",
      manifestPath: "backend/contracts/Cargo.toml",
      lockfilePath: entry.lockfilePath,
      name: "cruzible-contracts-workspace",
      version: "1.0.0",
      license: "NOASSERTION",
      dependencyType: "application",
      downloadLocation: "NONE",
    },
  ];

  for (const packageBlock of parseCargoPackageBlocks(
    readText(entry.lockfilePath),
  )) {
    if (!packageBlock.name || !packageBlock.version) {
      continue;
    }

    const isRegistryPackage =
      typeof packageBlock.source === "string" &&
      packageBlock.source.startsWith("registry+");

    components.push({
      ecosystem: "cargo",
      scope: entry.scope,
      kind: packageBlock.source ? "dependency" : "first-party",
      manifestPath: "backend/contracts/Cargo.toml",
      lockfilePath: entry.lockfilePath,
      name: packageBlock.name,
      version: packageBlock.version,
      license: "NOASSERTION",
      dependencyType: packageBlock.source ? "runtime" : "application",
      source: packageBlock.source,
      checksum: packageBlock.checksum,
      downloadLocation: isRegistryPackage
        ? packageBlock.source.replace(/^registry\+/, "")
        : "NONE",
    });
  }

  return components;
}

export function collectReleaseComponents() {
  return [
    ...NPM_LOCKFILES.flatMap(parseNpmLockfile),
    ...CARGO_LOCKFILES.flatMap(parseCargoLockfile),
  ].sort((left, right) =>
    [
      left.scope,
      left.ecosystem,
      left.name,
      left.version,
      left.packagePath ?? "",
      left.lockfilePath,
    ]
      .join("\0")
      .localeCompare(
        [
          right.scope,
          right.ecosystem,
          right.name,
          right.version,
          right.packagePath ?? "",
          right.lockfilePath,
        ].join("\0"),
      ),
  );
}

function spdxRefBase(component) {
  return [
    "SPDXRef",
    "Package",
    component.scope,
    component.ecosystem,
    component.name,
    component.version,
    component.packagePath ?? component.manifestPath,
  ]
    .join("-")
    .replace(/[^A-Za-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assignSpdxIds(components) {
  const seen = new Map();

  return components.map((component) => {
    const base = spdxRefBase(component) || "SPDXRef-Package-Unknown";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    return {
      ...component,
      spdxId: count === 0 ? base : `${base}-${count + 1}`,
    };
  });
}

function componentExternalRefs(component) {
  const purl =
    component.ecosystem === "npm" ? npmPurl(component) : cargoPurl(component);
  const refs = [
    {
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: purl,
    },
  ];

  if (component.ecosystem === "npm" && component.integrity) {
    refs.push({
      referenceCategory: "OTHER",
      referenceType: "other",
      referenceLocator: `npm-integrity:${component.integrity}`,
    });
  }

  if (component.ecosystem === "cargo" && component.checksum) {
    refs.push({
      referenceCategory: "OTHER",
      referenceType: "other",
      referenceLocator: `cargo-checksum:${component.checksum}`,
    });
  }

  return refs;
}

function componentComment(component) {
  return [
    `scope=${component.scope}`,
    `ecosystem=${component.ecosystem}`,
    `dependencyType=${component.dependencyType}`,
    `lockfile=${component.lockfilePath}`,
    component.packagePath ? `packagePath=${component.packagePath}` : undefined,
    component.optional ? "optional=true" : undefined,
  ]
    .filter(Boolean)
    .join("; ");
}

export function buildReleaseSbom() {
  const components = assignSpdxIds(collectReleaseComponents());
  const firstPartyPackages = components.filter(
    (component) => component.kind === "first-party",
  );
  const firstPartyByScope = new Map(
    firstPartyPackages
      .filter((component) => component.dependencyType === "application")
      .map((component) => [component.scope, component.spdxId]),
  );
  const sourceSha = gitValue(["rev-parse", "HEAD"]);
  const created = sourceDateIso();

  const packages = components.map((component) => ({
    name: component.name,
    SPDXID: component.spdxId,
    versionInfo: component.version,
    downloadLocation: component.downloadLocation,
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: component.license,
    copyrightText: "NOASSERTION",
    supplier: "NOASSERTION",
    originator: "NOASSERTION",
    externalRefs: componentExternalRefs(component),
    comment: componentComment(component),
  }));

  const relationships = [
    ...Array.from(firstPartyByScope.values()).map((spdxId) => ({
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: spdxId,
    })),
    ...components
      .filter((component) => component.kind === "dependency")
      .map((component) => ({
        spdxElementId: firstPartyByScope.get(component.scope),
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: component.spdxId,
      }))
      .filter((relationship) => relationship.spdxElementId),
  ];

  const document = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "cruzible-release-sbom",
    documentNamespace: `https://aethelred.foundation/spdx/cruzible/${sourceSha}`,
    creationInfo: {
      created,
      creators: ["Organization: Aethelred Foundation"],
      licenseListVersion: "3.21",
    },
    documentDescribes: Array.from(firstPartyByScope.values()).sort(),
    packages,
    relationships,
  };

  return {
    document,
    components,
    validation: validateReleaseSbom(document, components),
  };
}

export function validateReleaseSbom(document, components) {
  const errors = [];
  const packageIds = new Set();
  const scopeCounts = new Map(REQUIRED_SCOPES.map((scope) => [scope, 0]));

  if (document.spdxVersion !== "SPDX-2.3") {
    errors.push("SBOM must use SPDX 2.3.");
  }

  for (const component of components) {
    if (!component.name || !component.version || !component.spdxId) {
      errors.push(
        `Component ${component.scope}/${component.ecosystem} is missing name, version, or SPDX id.`,
      );
    }

    if (scopeCounts.has(component.scope)) {
      scopeCounts.set(component.scope, scopeCounts.get(component.scope) + 1);
    }

    if (packageIds.has(component.spdxId)) {
      errors.push(`Duplicate SPDX package id ${component.spdxId}.`);
    }
    packageIds.add(component.spdxId);

    if (
      component.ecosystem === "cargo" &&
      component.source?.startsWith("registry+") &&
      !component.checksum
    ) {
      errors.push(
        `Cargo registry package ${component.name}@${component.version} is missing a lockfile checksum.`,
      );
    }
  }

  for (const [scope, count] of scopeCounts) {
    if (count === 0) {
      errors.push(`SBOM is missing ${scope} components.`);
    }
  }

  if (components.length < MINIMUM_COMPONENT_COUNT) {
    errors.push(
      `Expected at least ${MINIMUM_COMPONENT_COUNT} release components, found ${components.length}.`,
    );
  }

  if (document.packages.length !== components.length) {
    errors.push("SPDX package count does not match parsed component count.");
  }

  return {
    ok: errors.length === 0,
    errors,
    componentCount: components.length,
    scopeCounts: Object.fromEntries(scopeCounts),
  };
}

function parseArgs(argv) {
  const options = {
    check: false,
    outputPath: undefined,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--check") {
      options.check = true;
      continue;
    }

    if (arg === "--output") {
      options.outputPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      options.outputPath = arg.slice("--output=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function writeSbom(relativeOutputPath, document) {
  const outputPath = path.isAbsolute(relativeOutputPath)
    ? relativeOutputPath
    : path.join(REPO_ROOT, relativeOutputPath);
  const outputDirectory = path.dirname(outputPath);

  if (!existsSync(outputDirectory)) {
    mkdirSync(outputDirectory, { recursive: true });
  }

  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  return outputPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { document, validation } = buildReleaseSbom();

  if (!validation.ok) {
    console.error("Release SBOM validation failed.");
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const scopeSummary = Object.entries(validation.scopeCounts)
    .map(([scope, count]) => `${scope}=${count}`)
    .join(", ");

  if (options.check) {
    console.log(
      `Release SBOM validation passed (${validation.componentCount} components; ${scopeSummary}).`,
    );
    return;
  }

  const outputPath = writeSbom(
    options.outputPath ?? DEFAULT_OUTPUT_PATH,
    document,
  );
  console.log(
    `Release SBOM written to ${path.relative(
      REPO_ROOT,
      outputPath,
    )} (${validation.componentCount} components; ${scopeSummary}).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
