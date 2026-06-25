#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAllDocuments } from "yaml";

const repoRoot = process.cwd();
const failures = [];
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const SLSA_PROVENANCE_TYPE = "https://slsa.dev/provenance/v1";

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readYamlDocuments(filePath) {
  const absolutePath = resolve(repoRoot, filePath);
  const source = readFileSync(absolutePath, "utf8");
  const documents = parseAllDocuments(source);

  for (const [index, document] of documents.entries()) {
    for (const error of document.errors) {
      fail(`${filePath} document ${index + 1}: ${error.message}`);
    }
  }

  return documents
    .filter((document) => document.contents)
    .map((document) => document.toJSON());
}

function getEnvMap(environment) {
  const entries = new Map();

  if (Array.isArray(environment)) {
    for (const item of environment) {
      if (typeof item !== "string") {
        continue;
      }

      const separatorIndex = item.indexOf("=");
      if (separatorIndex === -1) {
        entries.set(item, "");
        continue;
      }

      entries.set(
        item.slice(0, separatorIndex),
        item.slice(separatorIndex + 1),
      );
    }
  } else if (environment && typeof environment === "object") {
    for (const [key, value] of Object.entries(environment)) {
      entries.set(key, value);
    }
  }

  return entries;
}

function getNamed(resources, kind, name) {
  return resources.find(
    (resource) => resource?.kind === kind && resource?.metadata?.name === name,
  );
}

function collectKeylessIssuers(attestors) {
  return asArray(attestors).flatMap((attestor) =>
    asArray(attestor?.entries)
      .map((entry) => entry?.keyless?.issuer)
      .filter((issuer) => typeof issuer === "string"),
  );
}

function assertDigestImage(image, context) {
  assert(typeof image === "string", `${context} must define an image`);
  if (typeof image !== "string") {
    return;
  }

  assert(
    image.includes("@sha256:"),
    `${context} must use an immutable sha256 digest image`,
  );
  assert(!image.includes(":latest"), `${context} must not use :latest`);
}

function assertComposeImagePolicy(compose) {
  const services = compose.services ?? {};

  for (const [serviceName, service] of Object.entries(services)) {
    assert(!("build" in service), `compose ${serviceName} must not build`);
    assertDigestImage(service.image, `compose ${serviceName}`);
  }
}

function assertComposePortPolicy(compose) {
  const services = compose.services ?? {};

  for (const [serviceName, service] of Object.entries(services)) {
    for (const port of asArray(service.ports)) {
      if (typeof port !== "string") {
        fail(`compose ${serviceName} port mappings must be string literals`);
        continue;
      }

      if (serviceName === "nginx") {
        assert(
          port === "80:80" || port === "443:443",
          `compose nginx exposes unexpected public port ${port}`,
        );
        continue;
      }

      assert(
        port.startsWith("127.0.0.1:"),
        `compose ${serviceName} port ${port} must bind to localhost`,
      );
    }
  }
}

function assertComposeSecretPolicy(compose) {
  const services = compose.services ?? {};
  const declaredSecrets = compose.secrets ?? {};
  const requiredSecrets = [
    "cruzible_database_url",
    "cruzible_redis_url",
    "cruzible_redis_password",
    "cruzible_db_password",
    "cruzible_jwt_secret",
    "cruzible_jwt_refresh_secret",
    "cruzible_log_hash_secret",
    "cruzible_operational_token",
    "cruzible_grafana_password",
    "cruzible_tls_certificate",
    "cruzible_tls_private_key",
  ];
  const directSecretEnvNames = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "LOG_HASH_SECRET",
    "OPERATIONAL_ENDPOINTS_TOKEN",
    "POSTGRES_PASSWORD",
    "GF_SECURITY_ADMIN_PASSWORD",
  ];

  for (const secretName of requiredSecrets) {
    const secret = declaredSecrets[secretName];
    assert(secret, `compose secret ${secretName} must be declared`);
    assert(
      typeof secret?.file === "string" && secret.file.includes(":?set "),
      `compose secret ${secretName} must require an external file input`,
    );
  }

  for (const [serviceName, service] of Object.entries(services)) {
    const env = getEnvMap(service.environment);

    for (const envName of directSecretEnvNames) {
      assert(
        !env.has(envName),
        `compose ${serviceName} must not expose ${envName} as a direct environment value`,
      );
    }
  }

  for (const serviceName of ["api-gateway", "indexer"]) {
    const service = services[serviceName];
    const env = getEnvMap(service?.environment);
    const mountedSecrets = new Set(asArray(service?.secrets));

    for (const envName of [
      "DATABASE_URL_FILE",
      "REDIS_URL_FILE",
      "JWT_SECRET_FILE",
      "JWT_REFRESH_SECRET_FILE",
      "LOG_HASH_SECRET_FILE",
    ]) {
      assert(env.has(envName), `compose ${serviceName} must use ${envName}`);
    }

    if (serviceName === "api-gateway") {
      assert(
        env.has("OPERATIONAL_ENDPOINTS_TOKEN_FILE"),
        "compose api-gateway must use OPERATIONAL_ENDPOINTS_TOKEN_FILE",
      );
    }

    assert(
      mountedSecrets.has("cruzible_database_url"),
      `compose ${serviceName} must mount database URL as a secret`,
    );
    assert(
      mountedSecrets.has("cruzible_redis_url"),
      `compose ${serviceName} must mount Redis URL as a secret`,
    );
    assert(
      mountedSecrets.has("cruzible_log_hash_secret"),
      `compose ${serviceName} must mount log hash secret as a secret`,
    );
  }
}

function assertKustomization(resources) {
  const kustomization = resources.find(
    (resource) => resource?.kind === "Kustomization",
  );
  const declaredResources = new Set(asArray(kustomization?.resources));

  for (const resource of [
    "namespace.yaml",
    "backend.yaml",
    "frontend.yaml",
    "image-verification-policy.yaml",
    "network-policy.yaml",
  ]) {
    assert(
      declaredResources.has(resource),
      `kustomization must include ${resource}`,
    );
  }
}

function assertNamespacePolicy(resources) {
  const namespace = getNamed(resources, "Namespace", "cruzible");
  const labels = namespace?.metadata?.labels ?? {};

  for (const mode of ["enforce", "audit", "warn"]) {
    assert(
      labels[`pod-security.kubernetes.io/${mode}`] === "restricted",
      `namespace must set pod-security ${mode}=restricted`,
    );
  }
}

function assertKubernetesDeployment(deployment) {
  const name = deployment?.metadata?.name ?? "<unknown>";
  const spec = deployment?.spec ?? {};
  const podSpec = spec.template?.spec ?? {};
  const podSecurity = podSpec.securityContext ?? {};
  const containers = asArray(podSpec.containers);
  const volumes = asArray(podSpec.volumes);
  const tmpVolume = volumes.find((volume) => volume.name === "tmp");

  assert(
    deployment?.metadata?.namespace === "cruzible",
    `${name} must deploy into the cruzible namespace`,
  );
  assert(
    podSpec.automountServiceAccountToken === false,
    `${name} must disable service-account token automounting`,
  );
  assert(podSecurity.runAsNonRoot === true, `${name} must run as non-root`);
  assert(podSecurity.runAsUser === 1001, `${name} must pin runAsUser=1001`);
  assert(podSecurity.runAsGroup === 1001, `${name} must pin runAsGroup=1001`);
  assert(
    podSecurity.seccompProfile?.type === "RuntimeDefault",
    `${name} must use RuntimeDefault seccomp`,
  );
  assert(tmpVolume?.emptyDir?.sizeLimit === "256Mi", `${name} must bound /tmp`);

  for (const container of containers) {
    const context = `${name}/${container.name ?? "<container>"}`;
    const security = container.securityContext ?? {};
    const resources = container.resources ?? {};
    const requests = resources.requests ?? {};
    const limits = resources.limits ?? {};

    assertDigestImage(container.image, context);
    assert(
      container.imagePullPolicy === "IfNotPresent",
      `${context} must pin imagePullPolicy=IfNotPresent for digest images`,
    );
    assert(
      security.allowPrivilegeEscalation === false,
      `${context} must disable privilege escalation`,
    );
    assert(
      security.readOnlyRootFilesystem === true,
      `${context} must use a read-only root filesystem`,
    );
    assert(
      asArray(security.capabilities?.drop).includes("ALL"),
      `${context} must drop all Linux capabilities`,
    );

    for (const resourceName of ["cpu", "memory", "ephemeral-storage"]) {
      assert(
        requests[resourceName],
        `${context} must set ${resourceName} requests`,
      );
      assert(
        limits[resourceName],
        `${context} must set ${resourceName} limits`,
      );
    }
  }
}

function assertKubernetesSecretFilePolicy(deployment, secretFileEnvEntries) {
  if (!deployment) {
    fail("Kubernetes deployment with secret file policy was not found");
    return;
  }

  const name = deployment.metadata.name;
  const podSpec = deployment.spec.template.spec;
  const containers = asArray(podSpec.containers);
  const volumes = asArray(podSpec.volumes);
  const secretVolume = volumes.find(
    (volume) => volume.name === "api-secret-files",
  );

  assert(secretVolume, `${name} must mount API secret files`);
  assert(
    secretVolume?.secret?.secretName === "cruzible-api-secrets",
    `${name} must read from cruzible-api-secrets`,
  );
  assert(
    secretVolume?.secret?.defaultMode === 440,
    `${name} secret files must use defaultMode 0440`,
  );

  const secretItemPaths = new Set(
    asArray(secretVolume?.secret?.items).map((item) => item.path),
  );

  for (const [, fileName] of secretFileEnvEntries) {
    assert(
      secretItemPaths.has(fileName),
      `${name} must project ${fileName} from cruzible-api-secrets`,
    );
  }

  for (const container of containers) {
    const env = asArray(container.env);
    const envNames = new Set(env.map((item) => item.name));
    const mounts = asArray(container.volumeMounts);
    const secretMount = mounts.find(
      (mount) => mount.name === "api-secret-files",
    );

    assert(
      secretMount?.mountPath === "/var/run/secrets/cruzible-api",
      `${name}/${container.name} must mount secret files at the expected path`,
    );
    assert(
      secretMount?.readOnly === true,
      `${name}/${container.name} secret file mount must be read-only`,
    );

    for (const [envName, fileName] of secretFileEnvEntries) {
      assert(
        envNames.has(envName),
        `${name}/${container.name} must set ${envName}`,
      );
      assert(
        secretItemPaths.has(fileName),
        `${name}/${container.name} must project ${fileName}`,
      );
    }

    for (const secretName of [
      "DATABASE_URL",
      "REDIS_URL",
      "JWT_SECRET",
      "JWT_REFRESH_SECRET",
      "LOG_HASH_SECRET",
    ]) {
      assert(
        !envNames.has(secretName),
        `${name}/${container.name} must not expose ${secretName} directly`,
      );
    }
  }
}

function assertNetworkPolicies(resources) {
  const defaultDeny = getNamed(
    resources,
    "NetworkPolicy",
    "cruzible-default-deny",
  );
  const requiredPolicies = [
    "cruzible-frontend-network",
    "cruzible-api-network",
    "cruzible-indexer-network",
  ];

  assert(
    defaultDeny,
    "Kubernetes manifests must include a default-deny policy",
  );
  assert(
    JSON.stringify(defaultDeny?.spec?.podSelector ?? {}) === "{}",
    "default-deny policy must select every pod",
  );
  assert(
    asArray(defaultDeny?.spec?.policyTypes).includes("Ingress") &&
      asArray(defaultDeny?.spec?.policyTypes).includes("Egress"),
    "default-deny policy must cover ingress and egress",
  );

  for (const policyName of requiredPolicies) {
    const policy = getNamed(resources, "NetworkPolicy", policyName);
    assert(policy, `Kubernetes manifests must include ${policyName}`);
    assert(
      policy?.metadata?.namespace === "cruzible",
      `${policyName} must live in the cruzible namespace`,
    );
  }

  const serialized = JSON.stringify(resources);
  assert(
    !serialized.includes('"namespaceSelector":{}'),
    "network policies must not allow every namespace",
  );
}

function assertImageVerificationPolicy(resources) {
  const policy = getNamed(
    resources,
    "ClusterPolicy",
    "cruzible-verify-signed-images",
  );
  const rule = policy?.spec?.rules?.[0];
  const verifier = rule?.verifyImages?.[0];
  const references = verifier?.imageReferences ?? [];

  assert(
    policy,
    "Kubernetes manifests must include the image verification policy",
  );
  assert(
    policy?.spec?.validationFailureAction === "Enforce",
    "image verification policy must enforce validation failures",
  );
  assert(
    policy?.spec?.failurePolicy === "Fail",
    "image verification policy must fail closed",
  );
  assert(verifier?.required === true, "image verification must be required");
  assert(
    verifier?.verifyDigest === true,
    "image verification must verify digests",
  );
  assert(
    verifier?.mutateDigest === false,
    "image verification must not mutate digests",
  );

  for (const imageReference of [
    "ghcr.io/aethelred/cruzible/api@sha256:*",
    "ghcr.io/aethelred/cruzible/api-indexer@sha256:*",
    "ghcr.io/aethelred/cruzible/frontend@sha256:*",
  ]) {
    assert(
      references.includes(imageReference),
      `image verification must cover ${imageReference}`,
    );
  }

  const verifierIssuers = [
    ...collectKeylessIssuers(verifier?.attestors),
    ...asArray(verifier?.attestations).flatMap((attestation) =>
      collectKeylessIssuers(attestation?.attestors),
    ),
  ];
  const attestationTypes = asArray(verifier?.attestations)
    .map((attestation) => attestation?.type)
    .filter((attestationType) => typeof attestationType === "string");

  assert(
    verifierIssuers.includes(GITHUB_OIDC_ISSUER),
    "image verification must require the GitHub OIDC issuer",
  );
  assert(
    verifierIssuers.every((issuer) => issuer === GITHUB_OIDC_ISSUER),
    "image verification keyless issuers must exactly match the GitHub OIDC issuer",
  );
  assert(
    attestationTypes.includes(SLSA_PROVENANCE_TYPE),
    "image verification must require SLSA provenance",
  );
  assert(
    attestationTypes.every(
      (attestationType) => attestationType === SLSA_PROVENANCE_TYPE,
    ),
    "image verification attestation types must exactly match SLSA provenance",
  );
}

function validateCompose() {
  const compose = readYamlDocuments("backend/infra/docker-compose.yml")[0];

  assert(compose?.services, "compose manifest must define services");
  assertComposeImagePolicy(compose);
  assertComposePortPolicy(compose);
  assertComposeSecretPolicy(compose);
}

function validateKubernetes() {
  const resources = [
    ...readYamlDocuments("k8s/base/kustomization.yaml"),
    ...readYamlDocuments("k8s/base/namespace.yaml"),
    ...readYamlDocuments("k8s/base/backend.yaml"),
    ...readYamlDocuments("k8s/base/frontend.yaml"),
    ...readYamlDocuments("k8s/base/image-verification-policy.yaml"),
    ...readYamlDocuments("k8s/base/network-policy.yaml"),
  ];
  const expectedDeployments = [
    "cruzible-api",
    "cruzible-indexer",
    "cruzible-frontend",
  ];

  assertKustomization(resources);
  assertNamespacePolicy(resources);
  assertNetworkPolicies(resources);
  assertImageVerificationPolicy(resources);

  for (const deploymentName of expectedDeployments) {
    const deployment = getNamed(resources, "Deployment", deploymentName);
    assert(deployment, `Kubernetes manifests must include ${deploymentName}`);
    if (deployment) {
      assertKubernetesDeployment(deployment);
    }
  }

  assertKubernetesSecretFilePolicy(
    getNamed(resources, "Deployment", "cruzible-api"),
    [
      ["DATABASE_URL_FILE", "database-url"],
      ["REDIS_URL_FILE", "redis-url"],
      ["JWT_SECRET_FILE", "jwt-secret"],
      ["JWT_REFRESH_SECRET_FILE", "jwt-refresh-secret"],
      ["LOG_HASH_SECRET_FILE", "log-hash-secret"],
      ["OPERATIONAL_ENDPOINTS_TOKEN_FILE", "operational-endpoints-token"],
    ],
  );
  assertKubernetesSecretFilePolicy(
    getNamed(resources, "Deployment", "cruzible-indexer"),
    [
      ["DATABASE_URL_FILE", "database-url"],
      ["REDIS_URL_FILE", "redis-url"],
      ["JWT_SECRET_FILE", "jwt-secret"],
      ["JWT_REFRESH_SECRET_FILE", "jwt-refresh-secret"],
      ["LOG_HASH_SECRET_FILE", "log-hash-secret"],
    ],
  );
}

validateCompose();
validateKubernetes();

if (failures.length > 0) {
  console.error("Deployment manifest validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Deployment manifest validation passed.");
