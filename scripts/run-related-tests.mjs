import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TESTABLE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const FULL_TEST_TRIGGER_PATHS = new Set([
  "eslint.config.mjs",
  "next.config.js",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "postcss.config.js",
  "tailwind.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
  "vitest.setup.ts",
]);

const FULL_TEST_TRIGGER_PREFIXES = ["scripts/", "src/pages/"];

const BACKEND_API_PREFIX = "backend/api/";
const BACKEND_API_VALIDATION_STEPS = [
  ["npm", ["run", "format:check"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test", "--", "--run"]],
];

function normalizeGitPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function getStagedFiles() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB", "-z"],
    { encoding: "utf8" },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout
    .split("\0")
    .map((filePath) => normalizeGitPath(filePath.trim()))
    .filter(Boolean);
}

function shouldRunFullUnitSuite(filePath) {
  return (
    FULL_TEST_TRIGGER_PATHS.has(filePath) ||
    FULL_TEST_TRIGGER_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  );
}

function isTestableFile(filePath) {
  const extension = path.extname(filePath);

  return (
    TESTABLE_EXTENSIONS.has(extension) && existsSync(path.resolve(filePath))
  );
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function runInDirectory(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function runBackendApiValidation() {
  console.log("Backend API change detected; running backend quality gates.");

  for (const [command, args] of BACKEND_API_VALIDATION_STEPS) {
    const status = runInDirectory(command, args, "backend/api");
    if (status !== 0) {
      return status;
    }
  }

  return 0;
}

const stagedFiles = getStagedFiles();
const hasBackendApiChanges = stagedFiles.some((filePath) =>
  filePath.startsWith(BACKEND_API_PREFIX),
);

if (hasBackendApiChanges) {
  process.exit(runBackendApiValidation());
}

if (stagedFiles.some(shouldRunFullUnitSuite)) {
  console.log("Config or tooling change detected; running full unit suite.");
  process.exit(run("npm", ["test"]));
}

const relatedFiles = stagedFiles.filter(isTestableFile);

if (relatedFiles.length === 0) {
  console.log(
    "No staged JavaScript or TypeScript changes; skipping unit tests.",
  );
  process.exit(0);
}

console.log(
  `Running related unit tests for ${relatedFiles.length} staged file(s).`,
);
process.exit(
  run("npx", [
    "vitest",
    "related",
    "--config",
    "vitest.config.ts",
    "--run",
    ...relatedFiles,
  ]),
);
