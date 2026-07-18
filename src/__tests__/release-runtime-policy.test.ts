import { describe, expect, it } from "vitest";
import { validateReleaseRuntimePolicy } from "../../scripts/validate-release-runtime-policy.mjs";

function inventory(plaintext = "false", origins = "") {
  return {
    schema: "cruzible.release_image_promotion.v1",
    images: [
      {
        image_key: "frontend",
        build_configuration: {
          runtime_policy: {
            CRUZIBLE_EXTRA_API_ORIGINS: origins,
            CRUZIBLE_ALLOW_PLAINTEXT_HTTP: plaintext,
          },
        },
      },
    ],
  };
}

const manifest = `apiVersion: v1
kind: ConfigMap
metadata:
  name: cruzible-frontend-runtime-config
data:
  CRUZIBLE_EXTRA_API_ORIGINS: ""
  CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "false"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cruzible-frontend
`;

describe("frontend release runtime policy parity", () => {
  it("accepts a runtime ConfigMap matching the image build policy", () => {
    expect(
      validateReleaseRuntimePolicy({
        inventory: inventory(),
        frontendManifest: manifest,
      }),
    ).toEqual({
      CRUZIBLE_EXTRA_API_ORIGINS: "",
      CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "false",
    });
  });

  it("rejects plaintext or CSP origin drift between build and rollout", () => {
    expect(() =>
      validateReleaseRuntimePolicy({
        inventory: inventory("true", "http://api.example.org"),
        frontendManifest: manifest,
      }),
    ).toThrow("CRUZIBLE_EXTRA_API_ORIGINS differs");
  });
});
