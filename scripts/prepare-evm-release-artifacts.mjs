#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const CONTRACTS = ["Cruzible", "StAETHEL", "WstAETHEL"];
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/u;

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function resolveSourceSha(repoRoot, explicitSha) {
  const sourceSha =
    explicitSha ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) {
    throw new Error("source SHA must be a full 40-character lowercase git SHA");
  }
  return sourceSha;
}

function copyRequired(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`required release input is missing: ${source}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

/**
 * @param {{repoRoot?: string, outputDirectory?: string, sourceSha?: string}} [options]
 */
export function prepareEvmReleaseArtifacts(options = {}) {
  const {
    repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    outputDirectory,
    sourceSha,
  } = options;
  const root = resolve(repoRoot);
  const contractRoot = join(root, "backend", "contracts-evm");
  const allowedOutput = resolve(contractRoot, "release-artifacts");
  const output = resolve(outputDirectory ?? allowedOutput);

  if (output !== allowedOutput) {
    throw new Error(
      `release output must be exactly ${allowedOutput}; arbitrary recursive-delete targets are not allowed`,
    );
  }
  const realRoot = realpathSync(root);
  const realContractRoot = realpathSync(contractRoot);
  const contractRelativeToRepo = relative(realRoot, realContractRoot);
  if (
    !contractRelativeToRepo ||
    contractRelativeToRepo.startsWith("..") ||
    isAbsolute(contractRelativeToRepo)
  ) {
    throw new Error(
      "contract release root must be a real directory inside the repository",
    );
  }
  if (realpathSync(dirname(output)) !== realContractRoot) {
    throw new Error(
      "release output parent resolves outside the contract release root",
    );
  }
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) {
    throw new Error("release output must not be a symbolic link");
  }

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  for (const contract of CONTRACTS) {
    copyRequired(
      join(contractRoot, "artifacts", `${contract}.abi`),
      join(output, "artifacts", `${contract}.abi`),
    );
    copyRequired(
      join(contractRoot, "artifacts", `${contract}.bin`),
      join(output, "artifacts", `${contract}.bin`),
    );
    copyRequired(
      join(contractRoot, "artifacts", `${contract}.bin-runtime`),
      join(output, "artifacts", `${contract}.bin-runtime`),
    );
  }
  for (const path of ["src", "test", "foundry.toml", "build.sh"]) {
    copyRequired(join(contractRoot, path), join(output, path));
  }

  const commit = resolveSourceSha(root, sourceSha);
  const payloadFiles = listFiles(output);
  const manifest = {
    schema: "cruzible.evm_contract_release_bundle.v1",
    source: {
      repository: "https://github.com/aethelred-foundation/cruzible",
      git_commit: commit,
    },
    compiler: {
      solc: "0.8.20",
      optimizer: true,
      optimizer_runs: 200,
      via_ir: true,
      evm_version: "shanghai",
    },
    canonical_deployment_contracts: CONTRACTS,
    files: payloadFiles.map((path) => ({
      path: relative(output, path).split("\\").join("/"),
      bytes: statSync(path).size,
      sha256: sha256(path),
    })),
  };
  const manifestPath = join(output, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const checksumFiles = [...payloadFiles, manifestPath].sort((left, right) =>
    relative(output, left).localeCompare(relative(output, right)),
  );
  writeFileSync(
    join(output, "SHA256SUMS"),
    `${checksumFiles
      .map(
        (path) =>
          `${sha256(path)}  ${relative(output, path).split("\\").join("/")}`,
      )
      .join("\n")}\n`,
  );

  return { manifest, output };
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliEntrypoint) {
  try {
    const result = prepareEvmReleaseArtifacts({
      outputDirectory: readOption("--output"),
      sourceSha: readOption("--source-sha") ?? process.env.SOURCE_SHA,
    });
    console.log(
      `Prepared canonical EVM release bundle at ${result.output} (${result.manifest.files.length} files).`,
    );
  } catch (error) {
    console.error(`Failed to prepare EVM release artifacts: ${error.message}`);
    process.exit(1);
  }
}
