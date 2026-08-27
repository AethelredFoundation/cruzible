#!/usr/bin/env node

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FRONTEND_PUBLIC_BUILD_KEYS } from "./lib/frontend-public-env-keys.mjs";

export function canonicalize(value) {
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

export function fingerprintBuildConfiguration(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function createReleaseImageCandidate(env) {
  const imageKey = env.IMAGE_KEY;
  const buildConfiguration =
    imageKey === "frontend"
      ? {
          schema: "cruzible.frontend_build_configuration.v1",
          public: Object.fromEntries(
            FRONTEND_PUBLIC_BUILD_KEYS.map((key) => [key, env[key] ?? ""]),
          ),
          runtime_policy: {
            CRUZIBLE_EXTRA_API_ORIGINS: env.CRUZIBLE_EXTRA_API_ORIGINS ?? "",
            CRUZIBLE_ALLOW_PLAINTEXT_HTTP:
              env.CRUZIBLE_ALLOW_PLAINTEXT_HTTP || "false",
          },
        }
      : {
          schema: "cruzible.container_build_configuration.v1",
          dockerfile: env.IMAGE_DOCKERFILE,
          target: env.IMAGE_TARGET,
        };

  return {
    schema: "cruzible.release_image_candidate.v1",
    image_key: imageKey,
    image: env.IMAGE_NAME,
    digest: env.IMAGE_DIGEST,
    dockerfile: env.IMAGE_DOCKERFILE,
    target: env.IMAGE_TARGET,
    source_sha: env.SOURCE_SHA,
    candidate_tags: [env.CANDIDATE_TAG],
    build_configuration: buildConfiguration,
    build_config_sha256: fingerprintBuildConfiguration(buildConfiguration),
    gates: {
      vulnerability_scan: true,
      keyless_signature: true,
      provenance_attestation: true,
    },
  };
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliEntrypoint) {
  try {
    const inventory = createReleaseImageCandidate(process.env);
    if (!inventory.image_key) throw new Error("IMAGE_KEY is required");
    writeFileSync(
      `release-image-candidate-${inventory.image_key}.json`,
      `${JSON.stringify(inventory, null, 2)}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    console.error(
      `Release candidate inventory creation failed: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
