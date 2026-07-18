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

function getAllNamed(resources, kind, name) {
  return resources.filter(
    (resource) => resource?.kind === kind && resource?.metadata?.name === name,
  );
}

function networkPolicyPorts(policy) {
  return new Set(
    asArray(policy?.spec?.egress).flatMap((rule) =>
      asArray(rule?.ports)
        .map((port) => port?.port)
        .filter((port) => typeof port === "number"),
    ),
  );
}

function networkPolicyIpBlocks(policy) {
  return asArray(policy?.spec?.egress).flatMap((rule) =>
    asArray(rule?.to)
      .map((destination) => destination?.ipBlock?.cidr)
      .filter((cidr) => typeof cidr === "string"),
  );
}

function assertNoWildcardIpBlocks(resources, context) {
  for (const policy of resources.filter(
    (resource) => resource?.kind === "NetworkPolicy",
  )) {
    for (const cidr of networkPolicyIpBlocks(policy)) {
      assert(
        cidr !== "0.0.0.0/0" && cidr !== "::/0",
        `${context} ${policy.metadata?.name} must not allow wildcard egress ${cidr}`,
      );
    }
  }
}

function assertPodSelectorIncludesApps(policy, apps) {
  const expressions = asArray(policy?.spec?.podSelector?.matchExpressions);
  const appExpression = expressions.find(
    (expression) => expression?.key === "app" && expression?.operator === "In",
  );
  const values = new Set(asArray(appExpression?.values));

  for (const app of apps) {
    assert(
      values.has(app),
      `${policy?.metadata?.name} must select ${app} with an app matchExpression`,
    );
  }
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

function assertComposeExternalRedisPolicy(compose) {
  const services = compose.services ?? {};
  const volumes = compose.volumes ?? {};
  const secrets = compose.secrets ?? {};

  assert(
    !services.redis,
    "compose must use the external TLS Redis URL and must not bundle a plaintext Redis service",
  );
  assert(
    !volumes["redis-data"],
    "compose must not declare a bundled Redis volume",
  );
  assert(
    !secrets.cruzible_redis_password,
    "compose must not declare a bundled Redis server password secret",
  );

  for (const serviceName of ["api-gateway", "indexer"]) {
    const dependencies = services[serviceName]?.depends_on ?? {};
    assert(
      !Object.prototype.hasOwnProperty.call(dependencies, "redis"),
      `compose ${serviceName} must not depend on a bundled Redis service`,
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
  const containers = [
    ...asArray(podSpec.initContainers),
    ...asArray(podSpec.containers),
  ];
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

function assertFrontendRuntimePolicy(resources) {
  const config = getNamed(
    resources,
    "ConfigMap",
    "cruzible-frontend-runtime-config",
  );
  const deployment = getNamed(resources, "Deployment", "cruzible-frontend");

  assert(config, "frontend runtime policy ConfigMap must be present");
  assert(
    config?.metadata?.namespace === "cruzible",
    "frontend runtime policy ConfigMap must live in the cruzible namespace",
  );
  assert(
    config?.data?.CRUZIBLE_EXTRA_API_ORIGINS === "",
    "frontend runtime policy must default to no additional API origins",
  );
  assert(
    config?.data?.CRUZIBLE_ALLOW_PLAINTEXT_HTTP === "false",
    "frontend runtime policy must reject plaintext HTTP by default",
  );

  const frontend = asArray(deployment?.spec?.template?.spec?.containers).find(
    (container) => container?.name === "frontend",
  );
  const environment = new Map(
    asArray(frontend?.env).map((entry) => [entry?.name, entry]),
  );

  for (const key of [
    "CRUZIBLE_EXTRA_API_ORIGINS",
    "CRUZIBLE_ALLOW_PLAINTEXT_HTTP",
  ]) {
    const reference = environment.get(key)?.valueFrom?.configMapKeyRef;
    assert(
      reference?.name === "cruzible-frontend-runtime-config" &&
        reference?.key === key,
      `frontend must source ${key} from cruzible-frontend-runtime-config`,
    );
  }
}

function assertIndexerWorkerProbes(deployment) {
  const container = asArray(deployment?.spec?.template?.spec?.containers).find(
    (candidate) => candidate?.name === "indexer",
  );
  assert(container, "Kubernetes indexer container must be present");
  const environment = new Map(
    asArray(container?.env).map((entry) => [entry?.name, entry?.value]),
  );
  assert(
    environment.get("INDEXER_HEARTBEAT_FILE") ===
      "/tmp/cruzible-indexer-heartbeat.json",
    "Kubernetes indexer must write its heartbeat to bounded /tmp storage",
  );
  assert(
    environment.get("INDEXER_HEARTBEAT_MAX_AGE_MS") === "45000",
    "Kubernetes indexer must use the approved heartbeat maximum age",
  );

  for (const [probeName, periodSeconds, failureThreshold] of [
    ["startupProbe", 5, 36],
    ["readinessProbe", 10, 3],
    ["livenessProbe", 15, 4],
  ]) {
    const probe = container?.[probeName];
    assert(
      JSON.stringify(probe?.exec?.command) ===
        JSON.stringify(["node", "dist/indexer-healthcheck.js"]),
      `Kubernetes indexer ${probeName} must run the heartbeat watchdog`,
    );
    assert(
      probe?.periodSeconds === periodSeconds &&
        probe?.timeoutSeconds === 3 &&
        probe?.failureThreshold === failureThreshold,
      `Kubernetes indexer ${probeName} timing is not fail-safe`,
    );
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
  assertNoWildcardIpBlocks(resources, "base network policy");

  for (const policyName of [
    "cruzible-api-network",
    "cruzible-indexer-network",
  ]) {
    const policy = getNamed(resources, "NetworkPolicy", policyName);
    assert(
      networkPolicyIpBlocks(policy).length === 0,
      `${policyName} must not define external ipBlock egress in the base`,
    );
  }
}

function assertProductionEgressOverlay(resources) {
  const kustomization = resources.find(
    (resource) => resource?.kind === "Kustomization",
  );
  const declaredResources = new Set(asArray(kustomization?.resources));
  const requiredPolicies = {
    "cruzible-backend-state-egress": [5432, 6379],
    "cruzible-backend-rpc-egress": [443, 8545, 26657],
    "cruzible-api-alert-egress": [443],
  };

  assert(
    declaredResources.has("../../base"),
    "production egress overlay must include the hardened base",
  );
  assert(
    declaredResources.has("network-policy-egress-allowlist.yaml"),
    "production egress overlay must include its egress allowlist",
  );
  assertNoWildcardIpBlocks(resources, "production egress overlay");

  for (const [policyName, requiredPorts] of Object.entries(requiredPolicies)) {
    const policies = getAllNamed(resources, "NetworkPolicy", policyName);
    const policy = policies[0];
    const ports = networkPolicyPorts(policy);

    assert(
      policies.length === 1,
      `overlay must include exactly one ${policyName}`,
    );
    assert(
      policy?.metadata?.namespace === "cruzible",
      `${policyName} must live in the cruzible namespace`,
    );
    assert(
      policy?.metadata?.annotations?.[
        "egress.cruzible.io/replace-example-cidrs"
      ] === "true",
      `${policyName} must mark checked-in CIDRs as operator-replaced examples`,
    );
    assert(
      asArray(policy?.spec?.policyTypes).includes("Egress"),
      `${policyName} must enforce egress`,
    );
    assert(
      networkPolicyIpBlocks(policy).length > 0,
      `${policyName} must use explicit destination CIDRs`,
    );

    for (const port of requiredPorts) {
      assert(ports.has(port), `${policyName} must allow TCP/${port}`);
    }
  }

  assertPodSelectorIncludesApps(
    getNamed(resources, "NetworkPolicy", "cruzible-backend-state-egress"),
    ["cruzible-api", "cruzible-indexer"],
  );
  assertPodSelectorIncludesApps(
    getNamed(resources, "NetworkPolicy", "cruzible-backend-rpc-egress"),
    ["cruzible-api", "cruzible-indexer"],
  );
  assert(
    getNamed(resources, "NetworkPolicy", "cruzible-api-alert-egress")?.spec
      ?.podSelector?.matchLabels?.app === "cruzible-api",
    "alert webhook egress must be scoped to the API pods only",
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
    "ghcr.io/aethelred/cruzible/api-migration@sha256:*",
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
    verifierIssuers.some((issuer) => issuer === GITHUB_OIDC_ISSUER),
    "image verification must require the GitHub OIDC issuer",
  );
  assert(
    verifierIssuers.every((issuer) => issuer === GITHUB_OIDC_ISSUER),
    "image verification keyless issuers must exactly match the GitHub OIDC issuer",
  );
  assert(
    attestationTypes.some(
      (attestationType) => attestationType === SLSA_PROVENANCE_TYPE,
    ),
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
  assertComposeExternalRedisPolicy(compose);

  const migrationEnv = getEnvMap(compose?.services?.migrate?.environment);
  for (const envName of [
    "CRUZIBLE_MIGRATION_QUIESCED",
    "CRUZIBLE_LEGACY_SCHEDULERS_QUIESCED",
  ]) {
    assert(
      migrationEnv.get(envName)?.includes(":?set true only after"),
      `compose migration must require ${envName}`,
    );
  }
  const indexer = compose?.services?.indexer;
  const indexerEnv = getEnvMap(indexer?.environment);
  assert(
    indexerEnv.get("INDEXER_HEARTBEAT_FILE") ===
      "/tmp/cruzible-indexer-heartbeat.json",
    "compose indexer must write its heartbeat to /tmp",
  );
  assert(
    indexerEnv.get("INDEXER_HEARTBEAT_MAX_AGE_MS") === "45000",
    "compose indexer must use the approved heartbeat maximum age",
  );
  assert(
    JSON.stringify(indexer?.healthcheck?.test) ===
      JSON.stringify(["CMD", "node", "dist/indexer-healthcheck.js"]),
    "compose indexer healthcheck must run the heartbeat watchdog",
  );
  assert(
    indexer?.healthcheck?.interval === "15s" &&
      indexer?.healthcheck?.timeout === "3s" &&
      indexer?.healthcheck?.start_period === "90s" &&
      indexer?.healthcheck?.retries === 4,
    "compose indexer heartbeat healthcheck timing is not fail-safe",
  );

  const composeIndexerIdentity = new Map([
    [
      "INDEXER_EXPECTED_CHAIN_ID",
      "${INDEXER_EXPECTED_CHAIN_ID:?set INDEXER_EXPECTED_CHAIN_ID}",
    ],
    [
      "INDEXER_EXPECTED_GENESIS_HASH",
      "${INDEXER_EXPECTED_GENESIS_HASH:?set INDEXER_EXPECTED_GENESIS_HASH}",
    ],
    [
      "CRUZIBLE_VAULT_ADDRESS",
      "${CRUZIBLE_VAULT_ADDRESS:?set CRUZIBLE_VAULT_ADDRESS}",
    ],
    ["STAETHEL_ADDRESS", "${STAETHEL_ADDRESS:?set STAETHEL_ADDRESS}"],
    ["STABLECOIN_BRIDGE_ADDRESS", "${STABLECOIN_BRIDGE_ADDRESS:-}"],
  ]);
  const composeIdentityEnvironments = new Map();

  for (const serviceName of ["api-gateway", "indexer"]) {
    const env = getEnvMap(compose?.services?.[serviceName]?.environment);
    composeIdentityEnvironments.set(serviceName, env);
    for (const [envName, expectedValue] of composeIndexerIdentity) {
      assert(
        env.get(envName) === expectedValue,
        `compose ${serviceName} must source ${envName} from the canonical release input`,
      );
    }
  }

  for (const envName of composeIndexerIdentity.keys()) {
    assert(
      composeIdentityEnvironments.get("api-gateway")?.get(envName) ===
        composeIdentityEnvironments.get("indexer")?.get(envName),
      `compose API and indexer must use the same ${envName}`,
    );
  }
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
  const indexerIdentityConfigKeys = new Map([
    ["INDEXER_EXPECTED_CHAIN_ID", "indexer.expected.chain.id"],
    ["INDEXER_EXPECTED_GENESIS_HASH", "indexer.expected.genesis.hash"],
    ["CRUZIBLE_VAULT_ADDRESS", "cruzible.vault.address"],
    ["STAETHEL_ADDRESS", "staethel.address"],
    ["STABLECOIN_BRIDGE_ADDRESS", "stablecoin.bridge.address"],
  ]);

  assertKustomization(resources);
  assertNamespacePolicy(resources);
  assertNetworkPolicies(resources);
  assertImageVerificationPolicy(resources);
  assertFrontendRuntimePolicy(resources);

  const apiConfig = getNamed(resources, "ConfigMap", "cruzible-api-config");
  assert(
    apiConfig?.data?.["indexer.expected.chain.id"] ===
      "REPLACE_WITH_EXPECTED_CHAIN_ID",
    "Kubernetes API config must pin indexer.expected.chain.id",
  );
  assert(
    apiConfig?.data?.["indexer.expected.genesis.hash"] ===
      "REPLACE_WITH_EXPECTED_GENESIS_HASH",
    "Kubernetes API config must pin indexer.expected.genesis.hash",
  );
  assert(
    apiConfig?.data?.["migration.indexer.quiesced"] === "false",
    "Kubernetes migration must default indexer quiescence to false",
  );
  assert(
    apiConfig?.data?.["migration.legacy.schedulers.quiesced"] === "false",
    "Kubernetes migration must default legacy scheduler quiescence to false",
  );

  const migrationJob = getNamed(resources, "Job", "cruzible-db-migrate");
  assert(migrationJob, "Kubernetes manifests must include cruzible-db-migrate");
  if (migrationJob) {
    assertKubernetesDeployment(migrationJob);
    assert(
      migrationJob.metadata?.annotations?.[
        "cruzible.io/recreate-before-apply"
      ] === "required",
      "Kubernetes migration Job must be recreated for each release",
    );
    assert(
      migrationJob.metadata?.annotations?.[
        "cruzible.io/requires-indexer-quiescence"
      ] === "true",
      "Kubernetes migration Job must require indexer quiescence",
    );
    assert(
      migrationJob.metadata?.annotations?.[
        "cruzible.io/requires-legacy-scheduler-quiescence"
      ] === "true",
      "Kubernetes migration Job must require legacy scheduler quiescence",
    );
    const migrationEnv = new Map(
      asArray(migrationJob.spec?.template?.spec?.containers?.[0]?.env).map(
        (entry) => [entry?.name, entry?.valueFrom?.configMapKeyRef],
      ),
    );
    for (const [envName, key] of [
      ["CRUZIBLE_MIGRATION_QUIESCED", "migration.indexer.quiesced"],
      [
        "CRUZIBLE_LEGACY_SCHEDULERS_QUIESCED",
        "migration.legacy.schedulers.quiesced",
      ],
    ]) {
      const reference = migrationEnv.get(envName);
      assert(
        reference?.name === "cruzible-api-config" && reference?.key === key,
        `Kubernetes migration Job must source ${envName} from ${key}`,
      );
    }
    assertKubernetesSecretFilePolicy(migrationJob, [
      ["DATABASE_URL_FILE", "database-url"],
    ]);
  }

  const kubernetesIdentityEnvironments = new Map();
  for (const deploymentName of expectedDeployments) {
    const deployment = getNamed(resources, "Deployment", deploymentName);
    assert(deployment, `Kubernetes manifests must include ${deploymentName}`);
    if (deployment) {
      assertKubernetesDeployment(deployment);
      if (
        deploymentName === "cruzible-api" ||
        deploymentName === "cruzible-indexer"
      ) {
        const environment = new Map(
          asArray(deployment?.spec?.template?.spec?.containers?.[0]?.env).map(
            (entry) => [entry?.name, entry],
          ),
        );
        kubernetesIdentityEnvironments.set(deploymentName, environment);
        for (const [envName, expectedKey] of indexerIdentityConfigKeys) {
          const reference =
            environment.get(envName)?.valueFrom?.configMapKeyRef;
          assert(
            reference?.name === "cruzible-api-config" &&
              reference?.key === expectedKey,
            `Kubernetes ${deploymentName} must source ${envName} from ${expectedKey}`,
          );
        }
      }
    }
  }

  for (const envName of indexerIdentityConfigKeys.keys()) {
    const apiReference = kubernetesIdentityEnvironments
      .get("cruzible-api")
      ?.get(envName)?.valueFrom?.configMapKeyRef;
    const indexerReference = kubernetesIdentityEnvironments
      .get("cruzible-indexer")
      ?.get(envName)?.valueFrom?.configMapKeyRef;
    assert(
      JSON.stringify(apiReference) === JSON.stringify(indexerReference),
      `Kubernetes API and indexer must use the same ${envName} ConfigMap reference`,
    );
  }

  assertIndexerWorkerProbes(
    getNamed(resources, "Deployment", "cruzible-indexer"),
  );

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

function validateProductionEgressOverlay() {
  const resources = [
    ...readYamlDocuments("k8s/overlays/production-egress/kustomization.yaml"),
    ...readYamlDocuments(
      "k8s/overlays/production-egress/network-policy-egress-allowlist.yaml",
    ),
  ];

  assertProductionEgressOverlay(resources);
}

validateCompose();
validateKubernetes();
validateProductionEgressOverlay();

if (failures.length > 0) {
  console.error("Deployment manifest validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Deployment manifest validation passed.");
