import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_PACKAGE_MANAGER = "npm@10.9.4";
const EXPECTED_ENGINES = {
  node: ">=20.0.0",
  npm: ">=10.0.0",
};
const EXPECTED_LOCKFILE_VERSION = 3;
const REGISTRY_TARBALL_PREFIX = "https://registry.npmjs.org/";

const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "audit-artifacts",
  "coverage",
  "dist",
  "node_modules",
  "reports",
  "target",
]);

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const MANIFEST_SOURCE_FIELDS = [...DEPENDENCY_FIELDS, "overrides"];
const DISALLOWED_SPECIFIER_PATTERNS = [
  /^(?:git(?:\+ssh|\+https|\+http|\+file)?:|github:|gitlab:|bitbucket:)/i,
  /^(?:https?:|file:|link:|workspace:)/i,
];
const DESCOPED_CARGO_MANIFESTS = new Map([
  [
    "backend/node/Cargo.toml",
    "intentionally de-scoped from the production Docker Compose",
  ],
]);

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function sortObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortObject(nested)]),
  );
}

function valuesEqual(left, right) {
  return (
    JSON.stringify(sortObject(left ?? {})) ===
    JSON.stringify(sortObject(right ?? {}))
  );
}

function isExcludedPath(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath.split(path.sep).some((part) => EXCLUDED_DIRS.has(part));
}

function discoverFiles(root, fileName) {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (
          !EXCLUDED_DIRS.has(entry.name) &&
          !isExcludedPath(root, entryPath)
        ) {
          walk(entryPath);
        }
        continue;
      }

      if (entry.isFile() && entry.name === fileName) {
        files.push(entryPath);
      }
    }
  }

  walk(root);
  return files;
}

function discoverPackageManifests(root) {
  return discoverFiles(root, "package.json");
}

function discoverCargoManifests(root) {
  return discoverFiles(root, "Cargo.toml");
}

function collectDependencySpecifiers(value, pointer, output) {
  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nextPointer = `${pointer}.${key}`;

    if (typeof nested === "string") {
      output.push({ pointer: nextPointer, specifier: nested });
      continue;
    }

    collectDependencySpecifiers(nested, nextPointer, output);
  }
}

function findDisallowedDependencySpecifiers(manifest) {
  const specifiers = [];

  for (const field of MANIFEST_SOURCE_FIELDS) {
    collectDependencySpecifiers(manifest[field], field, specifiers);
  }

  return specifiers.filter(({ specifier }) =>
    DISALLOWED_SPECIFIER_PATTERNS.some((pattern) => pattern.test(specifier)),
  );
}

function pushError(errors, relativePath, message) {
  errors.push(`${relativePath}: ${message}`);
}

function validateManifestLockSync({
  errors,
  lock,
  lockPath,
  manifest,
  manifestPath,
  relativeManifestPath,
}) {
  const rootPackage = lock.packages?.[""];

  if (!rootPackage || typeof rootPackage !== "object") {
    pushError(
      errors,
      lockPath,
      'lockfile is missing packages[""] root metadata',
    );
    return;
  }

  for (const field of ["name", "version"]) {
    if (rootPackage[field] !== manifest[field]) {
      pushError(
        errors,
        relativeManifestPath,
        `manifest ${field} (${manifest[field] ?? "<missing>"}) does not match lockfile root (${rootPackage[field] ?? "<missing>"})`,
      );
    }
  }

  for (const field of DEPENDENCY_FIELDS) {
    if (!valuesEqual(rootPackage[field], manifest[field])) {
      pushError(
        errors,
        relativeManifestPath,
        `manifest ${field} is not synchronized with ${lockPath} packages[""] metadata`,
      );
    }
  }

  if (!valuesEqual(rootPackage.engines, manifest.engines)) {
    pushError(
      errors,
      relativeManifestPath,
      `manifest engines are not synchronized with ${lockPath} packages[""] metadata`,
    );
  }

  if (
    manifestPath.endsWith("package.json") &&
    statSync(manifestPath).size === 0
  ) {
    pushError(errors, relativeManifestPath, "manifest is empty");
  }
}

function validateLockPackages({ errors, lock, lockPath }) {
  if (lock.lockfileVersion !== EXPECTED_LOCKFILE_VERSION) {
    pushError(
      errors,
      lockPath,
      `lockfileVersion must be ${EXPECTED_LOCKFILE_VERSION}, got ${lock.lockfileVersion ?? "<missing>"}`,
    );
  }

  if (!lock.packages || typeof lock.packages !== "object") {
    pushError(errors, lockPath, "lockfile must contain a packages object");
    return;
  }

  for (const [packagePath, packageMetadata] of Object.entries(lock.packages)) {
    if (
      packagePath === "" ||
      !packageMetadata ||
      typeof packageMetadata !== "object" ||
      packageMetadata.link === true
    ) {
      continue;
    }

    if (
      typeof packageMetadata.resolved !== "string" ||
      !packageMetadata.resolved.startsWith(REGISTRY_TARBALL_PREFIX)
    ) {
      pushError(
        errors,
        lockPath,
        `${packagePath} must resolve from ${REGISTRY_TARBALL_PREFIX}`,
      );
    }

    if (
      typeof packageMetadata.integrity !== "string" ||
      !packageMetadata.integrity.startsWith("sha512-")
    ) {
      pushError(errors, lockPath, `${packagePath} must have sha512 integrity`);
    }
  }
}

function nearestCargoLock(root, manifestPath) {
  let directory = path.dirname(manifestPath);

  while (directory.startsWith(root)) {
    const candidate = path.join(directory, "Cargo.lock");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }

    directory = parent;
  }

  return undefined;
}

function validateCargoPolicy({ errors, manifestPath, root }) {
  const relativeManifestPath = normalizePath(path.relative(root, manifestPath));
  const cargoLockPath = nearestCargoLock(root, manifestPath);
  const manifestSource = readFileSync(manifestPath, "utf8");
  const isDescoped = DESCOPED_CARGO_MANIFESTS.has(relativeManifestPath);

  if (!cargoLockPath && !isDescoped) {
    pushError(
      errors,
      relativeManifestPath,
      "Cargo manifest must be covered by a committed Cargo.lock",
    );
  }

  if (isDescoped) {
    const readmePath = path.join(root, "backend/README.md");
    const readmeSource = existsSync(readmePath)
      ? readFileSync(readmePath, "utf8")
      : "";
    const requiredText = DESCOPED_CARGO_MANIFESTS.get(relativeManifestPath);

    if (!readmeSource.includes(requiredText)) {
      pushError(
        errors,
        relativeManifestPath,
        "de-scoped Cargo manifest must be documented in backend/README.md",
      );
    }

    return;
  }

  if (/\bgit\s*=/u.test(manifestSource)) {
    pushError(
      errors,
      relativeManifestPath,
      "production Cargo manifests must not depend on git sources",
    );
  }
}

export function validateDependencyPolicy(rootDirectory = process.cwd()) {
  const root = path.resolve(rootDirectory);

  if (!existsSync(root)) {
    throw new Error(`Dependency policy root does not exist: ${root}`);
  }

  const errors = [];
  const manifests = discoverPackageManifests(root);
  const cargoManifests = discoverCargoManifests(root);

  for (const manifestPath of manifests) {
    const projectRoot = path.dirname(manifestPath);
    const lockPath = path.join(projectRoot, "package-lock.json");
    const relativeManifestPath = normalizePath(
      path.relative(root, manifestPath),
    );
    const relativeLockPath = normalizePath(path.relative(root, lockPath));
    const manifest = readJson(manifestPath);

    if (manifest.packageManager !== EXPECTED_PACKAGE_MANAGER) {
      pushError(
        errors,
        relativeManifestPath,
        `packageManager must be ${EXPECTED_PACKAGE_MANAGER}`,
      );
    }

    if (!valuesEqual(manifest.engines, EXPECTED_ENGINES)) {
      pushError(
        errors,
        relativeManifestPath,
        `engines must be ${JSON.stringify(EXPECTED_ENGINES)}`,
      );
    }

    for (const finding of findDisallowedDependencySpecifiers(manifest)) {
      pushError(
        errors,
        relativeManifestPath,
        `${finding.pointer} uses disallowed non-registry specifier ${finding.specifier}`,
      );
    }

    if (!existsSync(lockPath)) {
      pushError(
        errors,
        relativeManifestPath,
        `missing ${path.basename(lockPath)}`,
      );
      continue;
    }

    const lock = readJson(lockPath);
    validateManifestLockSync({
      errors,
      lock,
      lockPath: relativeLockPath,
      manifest,
      manifestPath,
      relativeManifestPath,
    });
    validateLockPackages({ errors, lock, lockPath: relativeLockPath });
  }

  for (const manifestPath of cargoManifests) {
    validateCargoPolicy({ errors, manifestPath, root });
  }

  return {
    cargoManifests: cargoManifests.map((manifestPath) =>
      normalizePath(path.relative(root, manifestPath)),
    ),
    descopedCargoManifests: [...DESCOPED_CARGO_MANIFESTS.keys()],
    errors,
    packageManager: EXPECTED_PACKAGE_MANAGER,
    projects: manifests.map(
      (manifestPath) =>
        normalizePath(path.relative(root, path.dirname(manifestPath))) || ".",
    ),
  };
}

function printErrors(errors) {
  console.error("Dependency policy validation failed.");

  for (const error of errors) {
    console.error(`- ${error}`);
  }
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const result = validateDependencyPolicy(process.argv[2] ?? process.cwd());

  if (result.errors.length > 0) {
    printErrors(result.errors);
    process.exit(1);
  }

  console.log(
    `Dependency policy validation passed (${result.projects.length} npm projects; ${result.cargoManifests.length} Cargo manifests; ${result.packageManager}).`,
  );
}
