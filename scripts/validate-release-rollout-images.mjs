#!/usr/bin/env node

import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAllDocuments } from "yaml";
import { EXPECTED_RELEASE_IMAGES } from "./prepare-release-image-promotion.mjs";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const FIRST_PARTY_PREFIX = "ghcr.io/aethelred/cruzible/";
const DEPLOYMENT_AUTHORITY = "completed immutable digest inventory";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function collectImages(value, images) {
  if (Array.isArray(value)) {
    for (const item of value) collectImages(item, images);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "image" && typeof nested === "string") {
      images.push(nested.trim());
    } else {
      collectImages(nested, images);
    }
  }
}

function approvedImages(inventory) {
  assert(
    inventory?.schema === "cruzible.release_image_promotion.v1",
    "promotion inventory has an unsupported schema",
  );
  assert(
    inventory.promotion_status === "completed",
    "promotion inventory is not completed",
  );
  assert(
    inventory.channel_tags_are_deployment_authority === false &&
      inventory.deployment_authority === DEPLOYMENT_AUTHORITY,
    "promotion inventory does not authorize immutable-digest deployment",
  );
  assert(
    SOURCE_SHA_PATTERN.test(inventory.source_sha ?? ""),
    "promotion inventory has an invalid source SHA",
  );
  assert(
    Number.isFinite(Date.parse(inventory.promoted_at ?? "")),
    "promotion inventory has no valid completion timestamp",
  );
  assert(
    inventory.required_candidate_count === EXPECTED_RELEASE_IMAGES.length &&
      Array.isArray(inventory.images) &&
      inventory.images.length === EXPECTED_RELEASE_IMAGES.length,
    "promotion inventory must contain the complete four-image release",
  );

  const byKey = new Map();
  for (const image of inventory.images) {
    assert(
      typeof image?.image_key === "string" && !byKey.has(image.image_key),
      "promotion inventory contains duplicate or invalid image keys",
    );
    byKey.set(image.image_key, image);
  }

  return new Map(
    EXPECTED_RELEASE_IMAGES.map((expected) => {
      const image = byKey.get(expected.imageKey);
      assert(
        image?.image === expected.image,
        `promotion inventory is missing ${expected.imageKey}`,
      );
      assert(
        DIGEST_PATTERN.test(image.digest ?? ""),
        `${expected.imageKey} has an invalid digest`,
      );
      const immutableRef = `${expected.image}@${image.digest}`;
      assert(
        image.immutable_ref === immutableRef,
        `${expected.imageKey} immutable reference does not match its digest`,
      );
      return [expected.image, immutableRef];
    }),
  );
}

function parseManifestImages({ name, contents }) {
  const documents = parseAllDocuments(contents, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  const images = [];
  for (const document of documents) {
    if (document.errors.length > 0) {
      throw new Error(`${name} is invalid YAML: ${document.errors[0].message}`);
    }
    collectImages(document.toJS({ maxAliasCount: 0 }), images);
  }
  return images;
}

export function validateReleaseRolloutImages({ inventory, manifests }) {
  assert(
    Array.isArray(manifests) && manifests.length > 0,
    "at least one rendered rollout manifest is required",
  );
  const approved = approvedImages(inventory);
  const observed = new Set();

  for (const manifest of manifests) {
    for (const reference of parseManifestImages(manifest)) {
      if (!reference.startsWith(FIRST_PARTY_PREFIX)) continue;
      const imageName = reference.split(/[@:]/u, 1)[0];
      const expectedReference = approved.get(imageName);
      assert(
        expectedReference,
        `rendered rollout contains unapproved first-party image ${reference}`,
      );
      assert(
        reference === expectedReference,
        `rendered rollout must use ${expectedReference}, not ${reference}`,
      );
      observed.add(imageName);
    }
  }

  for (const [imageName, expectedReference] of approved) {
    assert(
      observed.has(imageName),
      `rendered rollout is missing ${expectedReference}`,
    );
  }

  return {
    sourceSha: inventory.source_sha,
    imageCount: observed.size,
  };
}

function readRegularFile(path, label) {
  const absolutePath = resolve(path);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlinked file`);
  }
  return {
    name: absolutePath,
    contents: readFileSync(absolutePath, "utf8"),
  };
}

function parseArguments(argv) {
  let promotionInventory;
  const manifests = [];
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--promotion-inventory", "--manifest"].includes(option)) {
      throw new Error(
        "usage: validate-release-rollout-images.mjs --promotion-inventory <json> --manifest <rendered-yaml> [--manifest <rendered-yaml> ...]",
      );
    }
    if (option === "--promotion-inventory") {
      if (promotionInventory) {
        throw new Error("--promotion-inventory may be specified only once");
      }
      promotionInventory = value;
    } else {
      manifests.push(value);
    }
  }
  if (!promotionInventory || manifests.length === 0) {
    throw new Error(
      "both --promotion-inventory and at least one --manifest are required",
    );
  }
  return { promotionInventory, manifests };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const inventoryFile = readRegularFile(
    options.promotionInventory,
    "promotion inventory",
  );
  let inventory;
  try {
    inventory = JSON.parse(inventoryFile.contents);
  } catch (error) {
    throw new Error(`promotion inventory is invalid JSON: ${error.message}`);
  }
  const result = validateReleaseRolloutImages({
    inventory,
    manifests: options.manifests.map((path) =>
      readRegularFile(path, "rollout manifest"),
    ),
  });
  console.log(
    `Validated ${result.imageCount} immutable release images from ${result.sourceSha}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(`Release rollout image validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
