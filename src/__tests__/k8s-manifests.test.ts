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
const kustomizationManifest = readFileSync(
  resolve(repoRoot, "k8s/base/kustomization.yaml"),
  "utf8",
);
const namespaceManifest = readFileSync(
  resolve(repoRoot, "k8s/base/namespace.yaml"),
  "utf8",
);
const imageVerificationPolicy = readFileSync(
  resolve(repoRoot, "k8s/base/image-verification-policy.yaml"),
  "utf8",
);
const networkPolicyManifest = readFileSync(
  resolve(repoRoot, "k8s/base/network-policy.yaml"),
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

function getNetworkPolicyBlock(name: string): string {
  const policy = networkPolicyManifest.match(
    new RegExp(
      String.raw`apiVersion: networking.k8s.io/v1[\s\S]*?kind: NetworkPolicy[\s\S]*?metadata:\n\s+name: ${name}[\s\S]*?(?=\n---|$)`,
    ),
  )?.[0];

  if (!policy) {
    throw new Error(`NetworkPolicy ${name} not found`);
  }

  return policy;
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

function expectRolloutBudget(
  manifest: string,
  deploymentName: string,
  terminationGracePeriodSeconds: number,
) {
  const deployment = getDeploymentBlock(manifest, deploymentName);

  expect(deployment).toContain("minReadySeconds: 10");
  expect(deployment).toContain("progressDeadlineSeconds: 600");
  expect(deployment).toContain("revisionHistoryLimit: 5");
  expect(deployment).toContain(
    `terminationGracePeriodSeconds: ${terminationGracePeriodSeconds}`,
  );
}

function expectTopologySpread(manifest: string, deploymentName: string) {
  const deployment = getDeploymentBlock(manifest, deploymentName);

  expect(deployment).toContain("topologySpreadConstraints:");
  expect(deployment).toContain("topologyKey: kubernetes.io/hostname");
  expect(deployment).toContain("topologyKey: topology.kubernetes.io/zone");
  expect(deployment).toContain("whenUnsatisfiable: ScheduleAnyway");
  expect(deployment).toContain(`app: ${deploymentName}`);
}

function expectContainerHardening(manifest: string, deploymentName: string) {
  const deployment = getDeploymentBlock(manifest, deploymentName);

  expect(deployment).toContain("allowPrivilegeEscalation: false");
  expect(deployment).toContain("readOnlyRootFilesystem: true");
  expect(deployment).toContain("drop:");
  expect(deployment).toContain("- ALL");
}

function expectBoundedTmpVolume(manifest: string, deploymentName: string) {
  const deployment = getDeploymentBlock(manifest, deploymentName);

  expect(deployment).toContain("mountPath: /tmp");
  expect(deployment).toContain("emptyDir:");
  expect(deployment).toContain("sizeLimit: 256Mi");
}

function expectEphemeralStorageBudget(
  manifest: string,
  deploymentName: string,
  request: string,
  limit: string,
) {
  const deployment = getDeploymentBlock(manifest, deploymentName);

  expect(deployment).toMatch(
    new RegExp(String.raw`requests:[\s\S]*ephemeral-storage:\s+"?${request}"?`),
  );
  expect(deployment).toMatch(
    new RegExp(String.raw`limits:[\s\S]*ephemeral-storage:\s+"?${limit}"?`),
  );
}

function expectSecretFileMount(
  manifest: string,
  deploymentName: string,
  includesOperationalToken: boolean,
) {
  const deployment = getDeploymentBlock(manifest, deploymentName);
  const secretFileEnv = [
    ["DATABASE_URL_FILE", "database-url"],
    ["REDIS_URL_FILE", "redis-url"],
    ["JWT_SECRET_FILE", "jwt-secret"],
    ["JWT_REFRESH_SECRET_FILE", "jwt-refresh-secret"],
    ["LOG_HASH_SECRET_FILE", "log-hash-secret"],
    ...(includesOperationalToken
      ? [["OPERATIONAL_ENDPOINTS_TOKEN_FILE", "operational-endpoints-token"]]
      : []),
  ];

  expect(deployment).toContain("volumeMounts:");
  expect(deployment).toContain("mountPath: /var/run/secrets/cruzible-api");
  expect(deployment).toContain("readOnly: true");
  expect(deployment).toContain("secretName: cruzible-api-secrets");
  expect(deployment).toContain("fsGroup: 1001");
  expect(deployment).toContain("defaultMode: 0440");
  expect(deployment).not.toContain("defaultMode: 0400");

  for (const [envName, fileName] of secretFileEnv) {
    expect(deployment).toContain(`name: ${envName}`);
    expect(deployment).toContain(
      `value: /var/run/secrets/cruzible-api/${fileName}`,
    );
    expect(deployment).toContain(`key: ${fileName}`);
    expect(deployment).toContain(`path: ${fileName}`);
    expect(deployment).not.toContain(
      `name: ${envName.replace(/_FILE$/, "")}\n              valueFrom:\n                secretKeyRef:`,
    );
  }
}

describe("Kubernetes base manifests", () => {
  it("enforces restricted pod security at the namespace boundary", () => {
    expect(kustomizationManifest).toContain("namespace.yaml");
    expect(namespaceManifest).toContain("kind: Namespace");
    expect(namespaceManifest).toContain("name: cruzible");
    expect(backendManifest).toContain("namespace: cruzible");
    expect(frontendManifest).toContain("namespace: cruzible");
    expect(networkPolicyManifest).toContain("namespace: cruzible");
    expect(namespaceManifest).toContain(
      "pod-security.kubernetes.io/enforce: restricted",
    );
    expect(namespaceManifest).toContain(
      "pod-security.kubernetes.io/audit: restricted",
    );
    expect(namespaceManifest).toContain(
      "pod-security.kubernetes.io/warn: restricted",
    );
    expect(namespaceManifest).toContain(
      "pod-security.kubernetes.io/enforce-version: latest",
    );
  });

  it("passes required indexer launch invariants through fail-closed config", () => {
    expect(backendManifest).toContain(
      'indexer.expected.chain.id: "REPLACE_WITH_EXPECTED_CHAIN_ID"',
    );
    expect(getDeploymentBlock(backendManifest, "cruzible-indexer")).toContain(
      "INDEXER_EXPECTED_CHAIN_ID",
    );
  });

  it("uses a production-safe CORS origin in the base backend config", () => {
    expect(backendManifest).toContain(
      'cors.origins: "https://vault.aethelred.org"',
    );
    expect(backendManifest).not.toContain("cruzible.example");
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

  it("enforces signed image and provenance admission for Cruzible images", () => {
    expect(kustomizationManifest).toContain("image-verification-policy.yaml");
    expect(imageVerificationPolicy).toContain("kind: ClusterPolicy");
    expect(imageVerificationPolicy).toContain(
      "name: cruzible-verify-signed-images",
    );
    expect(imageVerificationPolicy).toContain(
      "validationFailureAction: Enforce",
    );
    expect(imageVerificationPolicy).toContain("failurePolicy: Fail");
    expect(imageVerificationPolicy).toContain("verifyImages:");
    expect(imageVerificationPolicy).toContain("required: true");
    expect(imageVerificationPolicy).toContain("verifyDigest: true");
    expect(imageVerificationPolicy).toContain("mutateDigest: false");
    expect(imageVerificationPolicy).toContain(
      "ghcr.io/aethelred/cruzible/api@sha256:*",
    );
    expect(imageVerificationPolicy).toContain(
      "ghcr.io/aethelred/cruzible/api-indexer@sha256:*",
    );
    expect(imageVerificationPolicy).toContain(
      "ghcr.io/aethelred/cruzible/frontend@sha256:*",
    );
    expect(imageVerificationPolicy).toContain(
      "issuer: https://token.actions.githubusercontent.com",
    );
    expect(imageVerificationPolicy).toContain(
      "subject: https://github.com/aethelred-foundation/cruzible/.github/workflows/ci-cd.yml@refs/heads/main",
    );
    expect(imageVerificationPolicy).toContain(
      "type: https://slsa.dev/provenance/v1",
    );
  });

  it("mounts required API secret material as files instead of env values", () => {
    expectSecretFileMount(backendManifest, "cruzible-api", true);
    expectSecretFileMount(backendManifest, "cruzible-indexer", false);
  });

  it("keeps every workload on a restricted pod and container profile", () => {
    expectPodSecurityContext(backendManifest, "cruzible-api", 1001);
    expectPodSecurityContext(backendManifest, "cruzible-indexer", 1001);
    expectPodSecurityContext(frontendManifest, "cruzible-frontend", 1001);

    expectContainerHardening(backendManifest, "cruzible-api");
    expectContainerHardening(backendManifest, "cruzible-indexer");
    expectContainerHardening(frontendManifest, "cruzible-frontend");
  });

  it("keeps rollouts bounded and resilient during node maintenance", () => {
    expectRolloutBudget(backendManifest, "cruzible-api", 45);
    expectRolloutBudget(backendManifest, "cruzible-indexer", 60);
    expectRolloutBudget(frontendManifest, "cruzible-frontend", 45);

    expectTopologySpread(backendManifest, "cruzible-api");
    expectTopologySpread(frontendManifest, "cruzible-frontend");

    expect(backendManifest).toContain("kind: PodDisruptionBudget");
    expect(backendManifest).toContain("name: cruzible-api-pdb");
    expect(backendManifest).toContain("name: cruzible-indexer-pdb");
    expect(frontendManifest).toContain("kind: PodDisruptionBudget");
    expect(frontendManifest).toContain("name: cruzible-frontend-pdb");
    expect(frontendManifest).toContain("minAvailable: 2");
  });

  it("bounds writable runtime storage for read-only-root workloads", () => {
    expectBoundedTmpVolume(backendManifest, "cruzible-api");
    expectBoundedTmpVolume(backendManifest, "cruzible-indexer");
    expectBoundedTmpVolume(frontendManifest, "cruzible-frontend");

    expectEphemeralStorageBudget(
      backendManifest,
      "cruzible-api",
      "512Mi",
      "2Gi",
    );
    expectEphemeralStorageBudget(
      backendManifest,
      "cruzible-indexer",
      "512Mi",
      "2Gi",
    );
    expectEphemeralStorageBudget(
      frontendManifest,
      "cruzible-frontend",
      "256Mi",
      "1Gi",
    );
  });

  it("enforces fail-closed network policy boundaries", () => {
    const frontendPolicy = getNetworkPolicyBlock("cruzible-frontend-network");
    const apiPolicy = getNetworkPolicyBlock("cruzible-api-network");

    expect(kustomizationManifest).toContain("network-policy.yaml");
    expect(networkPolicyManifest).toContain("name: cruzible-default-deny");
    expect(networkPolicyManifest).toContain("podSelector: {}");
    expect(networkPolicyManifest).not.toContain("namespaceSelector: {}");
    expect(networkPolicyManifest).toContain("name: cruzible-frontend-network");
    expect(networkPolicyManifest).toContain("name: cruzible-api-network");
    expect(networkPolicyManifest).toContain("name: cruzible-indexer-network");
    expect(frontendPolicy).toContain(
      'networking.cruzible.io/external-ingress: "true"',
    );
    expect(apiPolicy).toContain("app: cruzible-frontend");
    expect(apiPolicy).toContain(
      'networking.cruzible.io/external-ingress: "true"',
    );
    expect(networkPolicyManifest).toContain("k8s-app: kube-dns");
    expect(networkPolicyManifest).toContain("app: cruzible-api");
    expect(networkPolicyManifest).toContain("port: 3000");
    expect(networkPolicyManifest).toContain("port: 443");
    expect(networkPolicyManifest).toContain("port: 5432");
    expect(networkPolicyManifest).toContain("port: 6379");
    expect(networkPolicyManifest).toContain("port: 8545");
    expect(networkPolicyManifest).toContain("port: 26657");
  });
});
