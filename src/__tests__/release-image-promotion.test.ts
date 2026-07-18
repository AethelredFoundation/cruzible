import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createReleaseImagePromotionPlan } from "../../scripts/prepare-release-image-promotion.mjs";
import { FRONTEND_PUBLIC_BUILD_KEYS } from "../../scripts/lib/frontend-public-env-keys.mjs";

const sourceSha = "a".repeat(40);
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const temporaryDirectories: string[] = [];

function canonicalize(value: unknown): unknown {
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

function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

const candidates = [
  {
    imageKey: "frontend",
    image: "ghcr.io/aethelred/cruzible/frontend",
    dockerfile: "Dockerfile",
    target: "runner",
    digest: digest("1"),
  },
  {
    imageKey: "api",
    image: "ghcr.io/aethelred/cruzible/api",
    dockerfile: "backend/api/Dockerfile",
    target: "production",
    digest: digest("2"),
  },
  {
    imageKey: "api-indexer",
    image: "ghcr.io/aethelred/cruzible/api-indexer",
    dockerfile: "backend/api/Dockerfile",
    target: "indexer",
    digest: digest("3"),
  },
  {
    imageKey: "api-migration",
    image: "ghcr.io/aethelred/cruzible/api-migration",
    dockerfile: "backend/api/Dockerfile",
    target: "migration",
    digest: digest("4"),
  },
] as const;

function writeCandidates(
  mutate?: (candidate: Record<string, unknown>, imageKey: string) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), "cruzible-promotion-"));
  temporaryDirectories.push(directory);

  for (const expected of candidates) {
    const buildConfiguration =
      expected.imageKey === "frontend"
        ? {
            schema: "cruzible.frontend_build_configuration.v1",
            public: Object.fromEntries(
              FRONTEND_PUBLIC_BUILD_KEYS.map((key) => [
                key,
                key === "NEXT_PUBLIC_CHAIN_ENV" ? "testnet" : "",
              ]),
            ),
            runtime_policy: {
              CRUZIBLE_EXTRA_API_ORIGINS: "",
              CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "false",
            },
          }
        : {
            schema: "cruzible.container_build_configuration.v1",
            dockerfile: expected.dockerfile,
            target: expected.target,
          };
    const candidate: Record<string, unknown> = {
      schema: "cruzible.release_image_candidate.v1",
      image_key: expected.imageKey,
      image: expected.image,
      digest: expected.digest,
      dockerfile: expected.dockerfile,
      target: expected.target,
      source_sha: sourceSha,
      candidate_tags: [`${expected.image}:${sourceSha}`],
      build_configuration: buildConfiguration,
      build_config_sha256: fingerprint(buildConfiguration),
      gates: {
        vulnerability_scan: true,
        keyless_signature: true,
        provenance_attestation: true,
      },
    };
    mutate?.(candidate, expected.imageKey);
    writeFileSync(
      join(directory, `release-image-candidate-${expected.imageKey}.json`),
      JSON.stringify(candidate),
    );
  }

  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("release image promotion inventory", () => {
  it("requires all four verified SHA-tagged candidates before planning promotion", () => {
    const plan = createReleaseImagePromotionPlan({
      candidateDirectory: writeCandidates(),
      sourceSha,
    });

    expect(plan.required_candidate_count).toBe(4);
    expect(plan.images.map((image) => image.image_key)).toEqual([
      "frontend",
      "api",
      "api-indexer",
      "api-migration",
    ]);
    expect(plan.images[0]).toMatchObject({
      immutable_ref: `ghcr.io/aethelred/cruzible/frontend@${digest("1")}`,
      candidate_tag: `ghcr.io/aethelred/cruzible/frontend:${sourceSha}`,
      promoted_tag: "ghcr.io/aethelred/cruzible/frontend:main",
    });
  });

  it("rejects a candidate that did not pass every release gate", () => {
    const directory = writeCandidates((candidate, imageKey) => {
      if (imageKey === "api") {
        candidate.gates = {
          vulnerability_scan: true,
          keyless_signature: true,
          provenance_attestation: false,
        };
      }
    });

    expect(() =>
      createReleaseImagePromotionPlan({
        candidateDirectory: directory,
        sourceSha,
      }),
    ).toThrow("provenance_attestation");
  });

  it("rejects mutable tags in candidate evidence", () => {
    const directory = writeCandidates((candidate, imageKey) => {
      if (imageKey === "frontend") {
        candidate.candidate_tags = [
          `ghcr.io/aethelred/cruzible/frontend:${sourceSha}`,
          "ghcr.io/aethelred/cruzible/frontend:main",
        ];
      }
    });

    expect(() =>
      createReleaseImagePromotionPlan({
        candidateDirectory: directory,
        sourceSha,
      }),
    ).toThrow("candidate_tags");
  });

  it("rejects a tampered build configuration fingerprint", () => {
    const directory = writeCandidates((candidate, imageKey) => {
      if (imageKey === "frontend") {
        const config = candidate.build_configuration as {
          runtime_policy: { CRUZIBLE_ALLOW_PLAINTEXT_HTTP: string };
        };
        config.runtime_policy.CRUZIBLE_ALLOW_PLAINTEXT_HTTP = "true";
      }
    });

    expect(() =>
      createReleaseImagePromotionPlan({
        candidateDirectory: directory,
        sourceSha,
      }),
    ).toThrow("build configuration fingerprint");
  });

  it("rejects missing, extra, or mismatched matrix inventories", () => {
    const directory = writeCandidates((candidate, imageKey) => {
      if (imageKey === "api-indexer") {
        candidate.source_sha = "b".repeat(40);
      }
    });

    expect(() =>
      createReleaseImagePromotionPlan({
        candidateDirectory: directory,
        sourceSha,
      }),
    ).toThrow("does not match the workflow source SHA");

    writeFileSync(join(directory, "unexpected.json"), "{}");
    expect(() =>
      createReleaseImagePromotionPlan({
        candidateDirectory: directory,
        sourceSha,
      }),
    ).toThrow("candidate inventory files");
  });
});
import { createHash } from "node:crypto";
