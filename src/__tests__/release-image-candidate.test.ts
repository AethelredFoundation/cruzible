import { describe, expect, it } from "vitest";
import {
  createReleaseImageCandidate,
  fingerprintBuildConfiguration,
} from "../../scripts/create-release-image-candidate.mjs";
import { FRONTEND_PUBLIC_BUILD_KEYS } from "../../scripts/lib/frontend-public-env-keys.mjs";

describe("release image candidate build evidence", () => {
  it("fingerprints the exact canonical frontend public build-key set", () => {
    const env = Object.fromEntries(
      FRONTEND_PUBLIC_BUILD_KEYS.map((key) => [key, `value-for-${key}`]),
    );
    const candidate = createReleaseImageCandidate({
      ...env,
      IMAGE_KEY: "frontend",
      IMAGE_NAME: "ghcr.io/aethelred/cruzible/frontend",
      IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
      IMAGE_DOCKERFILE: "Dockerfile",
      IMAGE_TARGET: "runner",
      SOURCE_SHA: "b".repeat(40),
      CANDIDATE_TAG: `ghcr.io/aethelred/cruzible/frontend:${"b".repeat(40)}`,
      CRUZIBLE_EXTRA_API_ORIGINS: "https://api.example.org",
      CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "false",
    });

    if (!candidate.build_configuration?.public) {
      throw new Error("frontend candidate is missing its public build config");
    }
    expect(Object.keys(candidate.build_configuration.public).sort()).toEqual(
      [...FRONTEND_PUBLIC_BUILD_KEYS].sort(),
    );
    expect(candidate.build_config_sha256).toBe(
      fingerprintBuildConfiguration(candidate.build_configuration),
    );
  });
});
