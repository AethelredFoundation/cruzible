import { describe, expect, it } from "vitest";
import { validateReleaseRolloutImages } from "../../scripts/validate-release-rollout-images.mjs";

const sourceSha = "a".repeat(40);
const imageSpecs = [
  ["frontend", "ghcr.io/aethelred/cruzible/frontend", "1"],
  ["api", "ghcr.io/aethelred/cruzible/api", "2"],
  ["api-indexer", "ghcr.io/aethelred/cruzible/api-indexer", "3"],
  ["api-migration", "ghcr.io/aethelred/cruzible/api-migration", "4"],
] as const;

function inventory() {
  return {
    schema: "cruzible.release_image_promotion.v1",
    source_sha: sourceSha,
    required_candidate_count: 4,
    promotion_status: "completed",
    promoted_at: "2026-07-18T12:00:00.000Z",
    channel_tags_are_deployment_authority: false,
    deployment_authority: "completed immutable digest inventory",
    images: imageSpecs.map(([imageKey, image, digit]) => ({
      image_key: imageKey,
      image,
      digest: `sha256:${digit.repeat(64)}`,
      immutable_ref: `${image}@sha256:${digit.repeat(64)}`,
    })),
  };
}

function manifest(overrides: Record<string, string> = {}) {
  return {
    name: "rendered.yaml",
    contents: imageSpecs
      .map(([imageKey, image, digit]) => {
        const reference =
          overrides[imageKey] ?? `${image}@sha256:${digit.repeat(64)}`;
        return `---\napiVersion: v1\nkind: Pod\nmetadata:\n  name: ${imageKey}\nspec:\n  containers:\n    - name: ${imageKey}\n      image: ${reference}\n`;
      })
      .join(""),
  };
}

describe("completed release rollout image binding", () => {
  it("accepts only the four immutable refs in the completed inventory", () => {
    expect(
      validateReleaseRolloutImages({
        inventory: inventory(),
        manifests: [manifest()],
      }),
    ).toEqual({ sourceSha, imageCount: 4 });
  });

  it("rejects a partial promotion plan as deployment authority", () => {
    const plan = inventory();
    delete (plan as { promotion_status?: string }).promotion_status;

    expect(() =>
      validateReleaseRolloutImages({
        inventory: plan,
        manifests: [manifest()],
      }),
    ).toThrow("not completed");
  });

  it("rejects mutable channel tags and unapproved digests", () => {
    expect(() =>
      validateReleaseRolloutImages({
        inventory: inventory(),
        manifests: [
          manifest({
            frontend: "ghcr.io/aethelred/cruzible/frontend:main",
          }),
        ],
      }),
    ).toThrow("must use");

    expect(() =>
      validateReleaseRolloutImages({
        inventory: inventory(),
        manifests: [
          manifest({
            api: `ghcr.io/aethelred/cruzible/api@sha256:${"9".repeat(64)}`,
          }),
        ],
      }),
    ).toThrow("must use");
  });

  it("rejects missing or unknown first-party release images", () => {
    const incomplete = manifest();
    incomplete.contents = incomplete.contents.replace(
      /---\napiVersion: v1\nkind: Pod\nmetadata:\n  name: api-migration[\s\S]*$/u,
      "",
    );
    expect(() =>
      validateReleaseRolloutImages({
        inventory: inventory(),
        manifests: [incomplete],
      }),
    ).toThrow("is missing");

    const unknown = manifest();
    unknown.contents +=
      "---\napiVersion: v1\nkind: Pod\nmetadata:\n  name: unknown\nspec:\n  containers:\n    - name: unknown\n      image: ghcr.io/aethelred/cruzible/unknown@sha256:" +
      "f".repeat(64) +
      "\n";
    expect(() =>
      validateReleaseRolloutImages({
        inventory: inventory(),
        manifests: [unknown],
      }),
    ).toThrow("unapproved first-party image");
  });
});
