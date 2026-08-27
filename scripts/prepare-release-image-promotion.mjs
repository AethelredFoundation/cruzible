#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FRONTEND_PUBLIC_BUILD_KEYS } from "./lib/frontend-public-env-keys.mjs";

export const EXPECTED_RELEASE_IMAGES = Object.freeze([
  Object.freeze({
    imageKey: "frontend",
    image: "ghcr.io/aethelred/cruzible/frontend",
    dockerfile: "Dockerfile",
    target: "runner",
  }),
  Object.freeze({
    imageKey: "api",
    image: "ghcr.io/aethelred/cruzible/api",
    dockerfile: "backend/api/Dockerfile",
    target: "production",
  }),
  Object.freeze({
    imageKey: "api-indexer",
    image: "ghcr.io/aethelred/cruzible/api-indexer",
    dockerfile: "backend/api/Dockerfile",
    target: "indexer",
  }),
  Object.freeze({
    imageKey: "api-migration",
    image: "ghcr.io/aethelred/cruzible/api-migration",
    dockerfile: "backend/api/Dockerfile",
    target: "migration",
  }),
]);

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function buildConfigHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function requireExactArray(actual, expected, context) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${context} must equal ${JSON.stringify(expected)}`);
  }
}

function readCandidate(candidateDirectory, expected, sourceSha) {
  const filename = `release-image-candidate-${expected.imageKey}.json`;
  const filePath = resolve(candidateDirectory, filename);
  const stat = lstatSync(filePath);

  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${filename} must be a regular, non-symlinked file`);
  }

  let candidate;
  try {
    candidate = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filename} is not valid JSON: ${error.message}`);
  }

  if (candidate?.schema !== "cruzible.release_image_candidate.v1") {
    throw new Error(`${filename} has an unsupported schema`);
  }
  if (candidate.image_key !== expected.imageKey) {
    throw new Error(`${filename} has an unexpected image_key`);
  }
  if (candidate.image !== expected.image) {
    throw new Error(`${filename} has an unexpected image name`);
  }
  if (candidate.dockerfile !== expected.dockerfile) {
    throw new Error(`${filename} has an unexpected Dockerfile`);
  }
  if (candidate.target !== expected.target) {
    throw new Error(`${filename} has an unexpected build target`);
  }
  if (candidate.source_sha !== sourceSha) {
    throw new Error(`${filename} does not match the workflow source SHA`);
  }
  if (!DIGEST_PATTERN.test(candidate.digest)) {
    throw new Error(`${filename} has an invalid immutable image digest`);
  }
  if (
    !candidate.build_configuration ||
    typeof candidate.build_configuration !== "object" ||
    Array.isArray(candidate.build_configuration)
  ) {
    throw new Error(`${filename} has no structured build configuration`);
  }
  if (
    !SHA256_PATTERN.test(candidate.build_config_sha256 ?? "") ||
    candidate.build_config_sha256 !==
      buildConfigHash(candidate.build_configuration)
  ) {
    throw new Error(
      `${filename} has an invalid build configuration fingerprint`,
    );
  }
  if (expected.imageKey === "frontend") {
    if (
      candidate.build_configuration.schema !==
      "cruzible.frontend_build_configuration.v1"
    ) {
      throw new Error(
        `${filename} has an unsupported frontend build configuration`,
      );
    }
    const runtimePolicy = candidate.build_configuration.runtime_policy;
    const publicConfig = candidate.build_configuration.public;
    const actualPublicKeys = Object.keys(publicConfig ?? {}).sort();
    const expectedPublicKeys = [...FRONTEND_PUBLIC_BUILD_KEYS].sort();
    requireExactArray(
      actualPublicKeys,
      expectedPublicKeys,
      `${filename} public build configuration keys`,
    );
    if (
      Object.values(publicConfig).some((value) => typeof value !== "string")
    ) {
      throw new Error(
        `${filename} public build configuration values must be strings`,
      );
    }
    if (
      typeof runtimePolicy?.CRUZIBLE_EXTRA_API_ORIGINS !== "string" ||
      !["true", "false"].includes(runtimePolicy?.CRUZIBLE_ALLOW_PLAINTEXT_HTTP)
    ) {
      throw new Error(`${filename} has an invalid frontend runtime policy`);
    }
  } else if (
    candidate.build_configuration.schema !==
      "cruzible.container_build_configuration.v1" ||
    candidate.build_configuration.dockerfile !== expected.dockerfile ||
    candidate.build_configuration.target !== expected.target
  ) {
    throw new Error(
      `${filename} has an unexpected container build configuration`,
    );
  }

  requireExactArray(
    candidate.candidate_tags,
    [`${expected.image}:${sourceSha}`],
    `${filename} candidate_tags`,
  );

  for (const gate of [
    "vulnerability_scan",
    "keyless_signature",
    "provenance_attestation",
  ]) {
    if (candidate.gates?.[gate] !== true) {
      throw new Error(`${filename} does not record a passed ${gate} gate`);
    }
  }

  return {
    image_key: expected.imageKey,
    image: expected.image,
    digest: candidate.digest,
    immutable_ref: `${expected.image}@${candidate.digest}`,
    candidate_tag: `${expected.image}:${sourceSha}`,
    promoted_tag: `${expected.image}:main`,
    dockerfile: expected.dockerfile,
    target: expected.target,
    build_configuration: candidate.build_configuration,
    build_config_sha256: candidate.build_config_sha256,
  };
}

export function createReleaseImagePromotionPlan({
  candidateDirectory,
  sourceSha,
}) {
  if (!SOURCE_SHA_PATTERN.test(sourceSha ?? "")) {
    throw new Error("source SHA must be a lowercase 40-character Git SHA");
  }

  const absoluteCandidateDirectory = resolve(candidateDirectory);
  const directoryStat = lstatSync(absoluteCandidateDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("candidate directory must be a non-symlinked directory");
  }

  const expectedFiles = EXPECTED_RELEASE_IMAGES.map(
    ({ imageKey }) => `release-image-candidate-${imageKey}.json`,
  ).sort();
  const actualFiles = readdirSync(absoluteCandidateDirectory).sort();
  requireExactArray(actualFiles, expectedFiles, "candidate inventory files");

  const images = EXPECTED_RELEASE_IMAGES.map((expected) =>
    readCandidate(absoluteCandidateDirectory, expected, sourceSha),
  );

  return {
    schema: "cruzible.release_image_promotion.v1",
    source_sha: sourceSha,
    required_candidate_count: EXPECTED_RELEASE_IMAGES.length,
    images,
  };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "usage: prepare-release-image-promotion.mjs --candidate-directory <path> --source-sha <sha> --output <path>",
      );
    }
    values.set(key, value);
  }

  for (const required of [
    "--candidate-directory",
    "--source-sha",
    "--output",
  ]) {
    if (!values.has(required)) {
      throw new Error(`missing required argument ${required}`);
    }
  }
  if (values.size !== 3) {
    throw new Error("unexpected command-line argument");
  }

  return {
    candidateDirectory: values.get("--candidate-directory"),
    sourceSha: values.get("--source-sha"),
    output: values.get("--output"),
  };
}

function main() {
  const { candidateDirectory, sourceSha, output } = parseArguments(
    process.argv.slice(2),
  );
  const plan = createReleaseImagePromotionPlan({
    candidateDirectory,
    sourceSha,
  });
  const outputPath = resolve(output);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(`Validated ${plan.images.length} release image candidates.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(
      `Release image promotion validation failed: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
