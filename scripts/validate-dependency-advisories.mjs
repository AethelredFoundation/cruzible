#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEPENDENCY_ADVISORY_REGISTER_PATH =
  "docs/security/dependency-advisory-register.json";

const SCHEMA = "cruzible.dependency_advisory_register.v1";
const SUPPORTED_ECOSYSTEMS = new Set(["npm", "rust"]);
const VALID_SEVERITIES = new Set(["critical", "high", "medium", "low"]);

function requireObject(value, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return {};
  }

  return value;
}

function requireString(value, label, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a non-empty string`);
    return "";
  }

  return value.trim();
}

function requirePositiveInteger(value, label, errors) {
  if (!Number.isInteger(value) || value < 1) {
    errors.push(`${label} must be a positive integer`);
    return 0;
  }

  return value;
}

function requireStringList(value, label, errors) {
  if (!Array.isArray(value) || value.length < 1) {
    errors.push(`${label} must be a non-empty array`);
    return [];
  }

  const strings = value.filter((item) => typeof item === "string" && item);
  if (strings.length !== value.length) {
    errors.push(`${label} must contain only non-empty strings`);
  }

  return strings;
}

function parseVersion(version) {
  const match = String(version).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/u);
  if (!match) {
    return null;
  }

  return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(left, right) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  if (!parsedLeft || !parsedRight) {
    return null;
  }

  for (let index = 0; index < 3; index += 1) {
    if (parsedLeft[index] > parsedRight[index]) return 1;
    if (parsedLeft[index] < parsedRight[index]) return -1;
  }

  return 0;
}

function comparatorMatches(version, operator, boundary) {
  const comparison = compareVersions(version, boundary);

  if (comparison === null) {
    return false;
  }

  switch (operator) {
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "=":
      return comparison === 0;
    default:
      return false;
  }
}

export function versionSatisfiesRange(version, vulnerableRange) {
  const comparators = [
    ...String(vulnerableRange).matchAll(
      /(<=|>=|<|>|=)\s*([0-9]+(?:\.[0-9]+){0,2}(?:[-+][0-9A-Za-z.-]+)?)/gu,
    ),
  ];

  if (comparators.length === 0) {
    return version === vulnerableRange;
  }

  return comparators.every(([, operator, boundary]) =>
    comparatorMatches(version, operator, boundary),
  );
}

function packageLockPathForManifest(manifestPath) {
  if (manifestPath.endsWith("package-lock.json")) {
    return manifestPath;
  }

  if (manifestPath.endsWith("package.json")) {
    return manifestPath.replace(/package\.json$/u, "package-lock.json");
  }

  return manifestPath;
}

function packagePathMatches(packagePath, packageName) {
  const suffix = `node_modules/${packageName}`;
  return packagePath === suffix || packagePath.endsWith(`/${suffix}`);
}

function npmPackageVersions(root, manifestPath, packageName) {
  const lockPath = path.join(root, packageLockPathForManifest(manifestPath));
  if (!existsSync(lockPath)) {
    return [];
  }

  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  return Object.entries(lock.packages ?? {})
    .filter(
      ([packagePath, metadata]) =>
        packagePathMatches(packagePath, packageName) && metadata?.version,
    )
    .map(([packagePath, metadata]) => ({
      source: packagePath,
      version: metadata.version,
    }));
}

function parseCargoLockVersions(lockSource, packageName) {
  return lockSource
    .split(/\n\[\[package\]\]\n/u)
    .map((block) => ({
      name: block.match(/^name = "([^"]+)"/mu)?.[1],
      version: block.match(/^version = "([^"]+)"/mu)?.[1],
    }))
    .filter((item) => item.name === packageName && item.version)
    .map((item) => ({ source: "Cargo.lock", version: item.version }));
}

function parseCargoTomlDependencyVersion(tomlSource, packageName) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const quotedDependency = new RegExp(
    `^${escapedName}\\s*=\\s*"([^"]+)"`,
    "mu",
  ).exec(tomlSource)?.[1];
  if (quotedDependency) {
    return [{ source: "Cargo.toml", version: quotedDependency }];
  }

  const tableDependency = new RegExp(
    `^${escapedName}\\s*=\\s*\\{[^\\n]*version\\s*=\\s*"([^"]+)"`,
    "mu",
  ).exec(tomlSource)?.[1];

  return tableDependency
    ? [{ source: "Cargo.toml", version: tableDependency }]
    : [];
}

function rustPackageVersions(root, manifestPath, packageName) {
  const absoluteManifestPath = path.join(root, manifestPath);
  const lockPath = absoluteManifestPath.replace(/Cargo\.toml$/u, "Cargo.lock");

  if (existsSync(lockPath)) {
    return parseCargoLockVersions(readFileSync(lockPath, "utf8"), packageName);
  }

  if (!existsSync(absoluteManifestPath)) {
    return [];
  }

  return parseCargoTomlDependencyVersion(
    readFileSync(absoluteManifestPath, "utf8"),
    packageName,
  );
}

function resolvedVersionsForGroup(root, group) {
  if (group.ecosystem === "npm") {
    return npmPackageVersions(root, group.manifest_path, group.package_name);
  }

  if (group.ecosystem === "rust") {
    return rustPackageVersions(root, group.manifest_path, group.package_name);
  }

  return [];
}

export function validateDependencyAdvisoryRegister(register) {
  const errors = [];
  const root = requireObject(register, "$", errors);

  if (root.schema !== SCHEMA) {
    errors.push(`$.schema must be ${SCHEMA}`);
  }

  const source = requireObject(root.source, "$.source", errors);
  const expectedAlertCount = requirePositiveInteger(
    source.alert_count,
    "$.source.alert_count",
    errors,
  );

  if (!Array.isArray(root.groups) || root.groups.length < 1) {
    errors.push("$.groups must be a non-empty array");
    return { errors, alertCount: expectedAlertCount, groupCount: 0 };
  }

  let groupedAlertCount = 0;
  const groupKeys = new Set();
  root.groups.forEach((group, index) => {
    const item = requireObject(group, `$.groups[${index}]`, errors);
    const manifestPath = requireString(
      item.manifest_path,
      `$.groups[${index}].manifest_path`,
      errors,
    );
    const ecosystem = requireString(
      item.ecosystem,
      `$.groups[${index}].ecosystem`,
      errors,
    );
    const packageName = requireString(
      item.package_name,
      `$.groups[${index}].package_name`,
      errors,
    );
    const alertCount = requirePositiveInteger(
      item.alert_count,
      `$.groups[${index}].alert_count`,
      errors,
    );
    const maxSeverity = requireString(
      item.max_severity,
      `$.groups[${index}].max_severity`,
      errors,
    );
    groupedAlertCount += alertCount;

    const groupKey = `${manifestPath}\0${ecosystem}\0${packageName}`;
    if (groupKeys.has(groupKey)) {
      errors.push(`$.groups contains duplicate target ${groupKey}`);
    }
    groupKeys.add(groupKey);

    if (!SUPPORTED_ECOSYSTEMS.has(ecosystem)) {
      errors.push(`$.groups[${index}].ecosystem is unsupported`);
    }

    if (!VALID_SEVERITIES.has(maxSeverity)) {
      errors.push(`$.groups[${index}].max_severity is invalid`);
    }

    requireStringList(
      item.vulnerable_ranges,
      `$.groups[${index}].vulnerable_ranges`,
      errors,
    );
    requireStringList(
      item.first_patched_versions,
      `$.groups[${index}].first_patched_versions`,
      errors,
    );
    requireStringList(
      item.advisory_ids,
      `$.groups[${index}].advisory_ids`,
      errors,
    );
  });

  if (groupedAlertCount !== expectedAlertCount) {
    errors.push(
      `Grouped alert count ${groupedAlertCount} must equal source alert count ${expectedAlertCount}`,
    );
  }

  return {
    errors,
    alertCount: expectedAlertCount,
    groupCount: root.groups.length,
  };
}

export function validateDependencyAdvisoryResolution({
  register,
  root = process.cwd(),
} = {}) {
  const registerValidation = validateDependencyAdvisoryRegister(register);
  const errors = [...registerValidation.errors];
  const groups = Array.isArray(register?.groups) ? register.groups : [];
  let checkedVersions = 0;

  groups.forEach((group) => {
    const versions = resolvedVersionsForGroup(root, group);
    checkedVersions += versions.length;

    versions.forEach(({ source, version }) => {
      const vulnerableRange = group.vulnerable_ranges.find((range) =>
        versionSatisfiesRange(version, range),
      );

      if (!vulnerableRange) {
        return;
      }

      errors.push(
        `${group.manifest_path}: ${group.package_name}@${version} from ${source} still satisfies vulnerable range ${vulnerableRange}`,
      );
    });
  });

  return {
    alertCount: registerValidation.alertCount,
    checkedVersions,
    errors,
    groupCount: registerValidation.groupCount,
  };
}

export function loadDependencyAdvisoryRegister(root = process.cwd()) {
  return JSON.parse(
    readFileSync(path.join(root, DEPENDENCY_ADVISORY_REGISTER_PATH), "utf8"),
  );
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const register = loadDependencyAdvisoryRegister();
  const { alertCount, checkedVersions, errors, groupCount } =
    validateDependencyAdvisoryResolution({ register });

  if (errors.length > 0) {
    console.error("Dependency advisory remediation validation failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Dependency advisory remediation validation passed (${alertCount} alerts covered across ${groupCount} grouped targets; ${checkedVersions} resolved package entries checked).`,
  );
}
