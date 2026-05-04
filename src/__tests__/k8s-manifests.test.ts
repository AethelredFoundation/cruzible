import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const backendManifest = readFileSync(
  resolve(repoRoot, "k8s/base/backend.yaml"),
  "utf8",
);
const frontendManifest = readFileSync(
  resolve(repoRoot, "k8s/base/frontend.yaml"),
  "utf8",
);

function getImageRefs(manifest: string): string[] {
  return Array.from(manifest.matchAll(/^\s*image:\s*(\S+)\s*$/gm)).map(
    (match) => match[1],
  );
}

function getDeploymentBlock(manifest: string, name: string): string {
  const deployment = manifest.match(
    new RegExp(
      String.raw`apiVersion: apps/v1[\s\S]*?kind: Deployment[\s\S]*?metadata:\n\s+name: ${name}[\s\S]*?(?=\n---|$)`,
    ),
  )?.[0];

  if (!deployment) {
    throw new Error(`Deployment ${name} not found`);
  }

  return deployment;
}

function expectPodSecurityContext(
  manifest: string,
  deploymentName: string,
  uid: number,
) {
  const deployment = getDeploymentBlock(manifest, deploymentName);

  expect(deployment).toContain("automountServiceAccountToken: false");
  expect(deployment).toContain("runAsNonRoot: true");
  expect(deployment).toContain(`runAsUser: ${uid}`);
  expect(deployment).toContain(`runAsGroup: ${uid}`);
  expect(deployment).toContain("seccompProfile:");
  expect(deployment).toContain("type: RuntimeDefault");
}

function expectContainerHardening(manifest: string, deploymentName: string) {
  const deployment = getDeploymentBlock(manifest, deploymentName);

  expect(deployment).toContain("allowPrivilegeEscalation: false");
  expect(deployment).toContain("readOnlyRootFilesystem: true");
  expect(deployment).toContain("drop:");
  expect(deployment).toContain("- ALL");
}

describe("Kubernetes base manifests", () => {
  it("passes required indexer launch invariants through fail-closed config", () => {
    expect(backendManifest).toContain(
      'indexer.expected.chain.id: "REPLACE_WITH_EXPECTED_CHAIN_ID"',
    );
    expect(getDeploymentBlock(backendManifest, "cruzible-indexer")).toContain(
      "INDEXER_EXPECTED_CHAIN_ID",
    );
  });

  it("requires immutable image digests instead of floating tags", () => {
    const images = getImageRefs(`${backendManifest}\n${frontendManifest}`);

    expect(images).toEqual(
      expect.arrayContaining([
        "ghcr.io/aethelred/cruzible/api@sha256:REPLACE_WITH_API_IMAGE_DIGEST",
        "ghcr.io/aethelred/cruzible/api-indexer@sha256:REPLACE_WITH_INDEXER_IMAGE_DIGEST",
        "ghcr.io/aethelred/cruzible/frontend@sha256:REPLACE_WITH_FRONTEND_IMAGE_DIGEST",
      ]),
    );
    expect(images.filter((image) => image.includes(":latest"))).toEqual([]);
    expect(images.filter((image) => !image.includes("@sha256:"))).toEqual([]);
  });

  it("keeps every workload on a restricted pod and container profile", () => {
    expectPodSecurityContext(backendManifest, "cruzible-api", 1001);
    expectPodSecurityContext(backendManifest, "cruzible-indexer", 1001);
    expectPodSecurityContext(frontendManifest, "cruzible-frontend", 1001);

    expectContainerHardening(backendManifest, "cruzible-api");
    expectContainerHardening(backendManifest, "cruzible-indexer");
    expectContainerHardening(frontendManifest, "cruzible-frontend");
  });
});
