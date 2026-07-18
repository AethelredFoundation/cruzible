#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const POLICY_KEYS = [
  "CRUZIBLE_EXTRA_API_ORIGINS",
  "CRUZIBLE_ALLOW_PLAINTEXT_HTTP",
];

function yamlScalar(document, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = document.match(
    new RegExp(
      `^\\s{2}${escaped}:\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))\\s*$`,
      "mu",
    ),
  );
  if (!match) throw new Error(`frontend runtime ConfigMap is missing ${key}`);
  return match[1] ?? match[2] ?? match[3];
}

export function validateReleaseRuntimePolicy({ inventory, frontendManifest }) {
  if (inventory?.schema !== "cruzible.release_image_promotion.v1") {
    throw new Error("promotion inventory has an unsupported schema");
  }
  const frontendCandidates = (inventory.images ?? []).filter(
    (image) => image.image_key === "frontend",
  );
  if (frontendCandidates.length !== 1) {
    throw new Error(
      "promotion inventory must contain exactly one frontend image",
    );
  }
  const runtimePolicy =
    frontendCandidates[0].build_configuration?.runtime_policy;
  if (!runtimePolicy) {
    throw new Error("frontend candidate has no attested runtime policy");
  }

  const configDocument = frontendManifest
    .split(/^---\s*$/mu)
    .find(
      (document) =>
        /^kind:\s*ConfigMap\s*$/mu.test(document) &&
        /^\s{2}name:\s*cruzible-frontend-runtime-config\s*$/mu.test(document),
    );
  if (!configDocument) {
    throw new Error("frontend runtime ConfigMap is missing");
  }

  for (const key of POLICY_KEYS) {
    const deployedValue = yamlScalar(configDocument, key);
    if (runtimePolicy[key] !== deployedValue) {
      throw new Error(
        `${key} differs between the frontend image build and runtime ConfigMap`,
      );
    }
  }
  return runtimePolicy;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliEntrypoint) {
  try {
    const inventoryPath = option("--promotion-inventory");
    const manifestPath = option("--frontend-manifest");
    if (!inventoryPath || !manifestPath) {
      throw new Error(
        "usage: validate-release-runtime-policy.mjs --promotion-inventory <json> --frontend-manifest <yaml>",
      );
    }
    validateReleaseRuntimePolicy({
      inventory: JSON.parse(readFileSync(resolve(inventoryPath), "utf8")),
      frontendManifest: readFileSync(resolve(manifestPath), "utf8"),
    });
    console.log(
      "Frontend image build policy matches the deployment runtime ConfigMap.",
    );
  } catch (error) {
    console.error(`Release runtime policy validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
