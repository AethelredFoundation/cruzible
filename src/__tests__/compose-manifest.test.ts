import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const infraDir = resolve(process.cwd(), "backend/infra");
const composeManifest = readFileSync(
  resolve(infraDir, "docker-compose.yml"),
  "utf8",
);
const prometheusConfig = readFileSync(
  resolve(infraDir, "config/prometheus/prometheus.yml"),
  "utf8",
);

function expectRequiredVariable(variable: string) {
  expect(composeManifest).toContain(`\${${variable}:?set ${variable}}`);
}

function getLocalBindMountSources(): string[] {
  return Array.from(composeManifest.matchAll(/^\s+-\s+(\.\/[^:\n]+):/gm))
    .map((match) => match[1])
    .sort();
}

describe("Docker Compose production scaffold", () => {
  it("does not provide fallback production credentials or origins", () => {
    expect(composeManifest).not.toContain(":-changeme");
    expect(composeManifest).not.toContain("POSTGRES_PASSWORD=${");
    expect(composeManifest).not.toContain("DATABASE_URL=postgresql://");
    expect(composeManifest).not.toContain("JWT_SECRET=${");
    expect(composeManifest).not.toContain("JWT_REFRESH_SECRET=${");
    expect(composeManifest).not.toContain("OPERATIONAL_ENDPOINTS_TOKEN=${");
    expect(composeManifest).not.toContain("GF_SECURITY_ADMIN_PASSWORD=${");
    expect(composeManifest).not.toContain("CORS_ORIGINS=${CORS_ORIGINS:-");

    expectRequiredVariable("DB_USER");
    expectRequiredVariable("DB_PASSWORD_FILE");
    expectRequiredVariable("DB_NAME");
    expectRequiredVariable("DATABASE_URL_FILE");
    expectRequiredVariable("REDIS_URL_FILE");
    expectRequiredVariable("REDIS_PASSWORD_FILE");
    expectRequiredVariable("RPC_URL");
    expectRequiredVariable("GRPC_URL");
    expectRequiredVariable("CORS_ORIGINS");
    expectRequiredVariable("JWT_SECRET_FILE");
    expectRequiredVariable("JWT_REFRESH_SECRET_FILE");
    expectRequiredVariable("LOG_HASH_SECRET_FILE");
    expectRequiredVariable("OPERATIONAL_ENDPOINTS_TOKEN_FILE");
    expectRequiredVariable("GRAFANA_USER");
    expectRequiredVariable("GRAFANA_PASSWORD_FILE");
    expectRequiredVariable("GRAFANA_ROOT_URL");
    expectRequiredVariable("NGINX_TLS_CERT_FILE");
    expectRequiredVariable("NGINX_TLS_KEY_FILE");
  });

  it("mounts high-value credentials through Docker secrets", () => {
    for (const secretName of [
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
    ]) {
      expect(composeManifest).toContain(`${secretName}:`);
      expect(composeManifest).toContain(`- ${secretName}`);
    }

    expect(composeManifest).toContain(
      "DATABASE_URL_FILE=/run/secrets/cruzible_database_url",
    );
    expect(composeManifest).toContain(
      "REDIS_URL_FILE=/run/secrets/cruzible_redis_url",
    );
    expect(composeManifest).toContain(
      "JWT_SECRET_FILE=/run/secrets/cruzible_jwt_secret",
    );
    expect(composeManifest).toContain(
      "JWT_REFRESH_SECRET_FILE=/run/secrets/cruzible_jwt_refresh_secret",
    );
    expect(composeManifest).toContain(
      "LOG_HASH_SECRET_FILE=/run/secrets/cruzible_log_hash_secret",
    );
    expect(composeManifest).toContain(
      "OPERATIONAL_ENDPOINTS_TOKEN_FILE=/run/secrets/cruzible_operational_token",
    );
    expect(composeManifest).toContain(
      "POSTGRES_PASSWORD_FILE=/run/secrets/cruzible_db_password",
    );
    expect(composeManifest).toContain(
      "GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/cruzible_grafana_password",
    );
  });

  it("checks in every local config source referenced by bind mounts", () => {
    const localSources = getLocalBindMountSources();

    expect(localSources).toEqual([
      "./config/grafana/dashboards",
      "./config/grafana/datasources",
      "./config/nginx/nginx.conf",
      "./config/prometheus/alerts.yml",
      "./config/prometheus/prometheus.yml",
      "./config/redis/redis.conf",
      "./init/postgres",
    ]);

    for (const source of localSources) {
      expect(existsSync(resolve(infraDir, source)), source).toBe(true);
    }
  });

  it("authenticates Redis and operational metrics in the local production stack", () => {
    expect(composeManifest).toContain("cruzible_redis_password");
    expect(composeManifest).toContain("--requirepass");
    expect(composeManifest).toContain(
      'redis-cli -a "$$(cat /run/secrets/cruzible_redis_password)" ping',
    );
    expect(prometheusConfig).toContain(
      "bearer_token_file: /run/secrets/cruzible_operational_token",
    );
  });

  it("terminates nginx TLS from secrets and health-checks nginx itself", () => {
    expect(composeManifest).not.toContain("./config/nginx/ssl");
    expect(composeManifest).toContain("cruzible_tls_certificate");
    expect(composeManifest).toContain("cruzible_tls_private_key");
    expect(composeManifest).toContain("http://localhost/nginx-health");
  });

  it("requires explicit indexer chain identity for production indexing", () => {
    expect(composeManifest).toContain(
      "INDEXER_EXPECTED_CHAIN_ID=${INDEXER_EXPECTED_CHAIN_ID:?set INDEXER_EXPECTED_CHAIN_ID}",
    );
  });

  it("pins service images through required digest inputs", () => {
    expect(composeManifest).not.toContain(":latest");

    for (const variable of [
      "CRUZIBLE_API_IMAGE_DIGEST",
      "CRUZIBLE_INDEXER_IMAGE_DIGEST",
      "POSTGRES_IMAGE_DIGEST",
      "REDIS_IMAGE_DIGEST",
      "NGINX_IMAGE_DIGEST",
      "PROMETHEUS_IMAGE_DIGEST",
      "GRAFANA_IMAGE_DIGEST",
      "JAEGER_IMAGE_DIGEST",
    ]) {
      expectRequiredVariable(variable);
    }
  });

  it("runs first-party services from release image digests", () => {
    expect(composeManifest).not.toContain("build:");
    expect(composeManifest).not.toContain("dockerfile: backend/api/Dockerfile");
    expect(composeManifest).toContain(
      "image: ghcr.io/aethelred/cruzible/api@sha256:${CRUZIBLE_API_IMAGE_DIGEST:?set CRUZIBLE_API_IMAGE_DIGEST}",
    );
    expect(composeManifest).toContain(
      "image: ghcr.io/aethelred/cruzible/api-indexer@sha256:${CRUZIBLE_INDEXER_IMAGE_DIGEST:?set CRUZIBLE_INDEXER_IMAGE_DIGEST}",
    );
  });

  it("keeps internal service ports off public host interfaces", () => {
    for (const port of ["3000", "5432", "6379"]) {
      expect(composeManifest).not.toContain(`"${port}:${port}"`);
      expect(composeManifest).toContain(`"127.0.0.1:${port}:${port}"`);
    }

    expect(composeManifest).toContain('"127.0.0.1:3002:3000"');
    expect(composeManifest).toContain('"127.0.0.1:16686:16686"');
    expect(composeManifest).toContain('"127.0.0.1:14250:14250"');
  });

  it("pins API proxy trust to the nginx hop", () => {
    expect(composeManifest).toContain("TRUST_PROXY=1");
    expect(composeManifest).not.toContain("TRUST_PROXY=true");
  });

  it("does not build the incomplete node scaffold in the production stack", () => {
    expect(composeManifest).not.toContain("context: ../node");
    expect(composeManifest).not.toContain("aethelred-node:");
    expect(composeManifest).not.toContain("seed-node:");
    expect(composeManifest).toContain("RPC_URL=${RPC_URL:?set RPC_URL}");
    expect(composeManifest).toContain("GRPC_URL=${GRPC_URL:?set GRPC_URL}");
    expect(composeManifest).toContain(
      "INDEXER_RPC_URL=${INDEXER_RPC_URL:?set INDEXER_RPC_URL}",
    );
    expect(composeManifest).toContain(
      "INDEXER_WS_URL=${INDEXER_WS_URL:?set INDEXER_WS_URL}",
    );
  });
});
