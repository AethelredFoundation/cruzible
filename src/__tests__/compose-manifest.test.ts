import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const infraDir = resolve(process.cwd(), "backend/infra");
const composeManifest = readFileSync(
  resolve(infraDir, "docker-compose.yml"),
  "utf8",
);
const testnetComposeManifest = readFileSync(
  resolve(process.cwd(), "docker-compose.yml"),
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
    expectRequiredVariable("RPC_URL");
    expectRequiredVariable("GRPC_URL");
    expectRequiredVariable("CORS_ORIGINS");
    expectRequiredVariable("AUTH_OPERATOR_ADDRESSES");
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
      "./init/postgres",
    ]);

    for (const source of localSources) {
      expect(existsSync(resolve(infraDir, source)), source).toBe(true);
    }
  });

  it("requires external TLS Redis and authenticates operational metrics", () => {
    expect(composeManifest).toContain(
      "REDIS_URL_FILE=/run/secrets/cruzible_redis_url",
    );
    expect(composeManifest).not.toMatch(/^  redis:$/m);
    expect(composeManifest).not.toContain("REDIS_IMAGE_DIGEST");
    expect(composeManifest).not.toContain("cruzible_redis_password");
    expect(composeManifest).not.toContain("redis-data");
    expect(composeManifest).not.toMatch(/^\s+redis:\s*$/m);
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
    expect(
      composeManifest.match(
        /INDEXER_EXPECTED_CHAIN_ID=\$\{INDEXER_EXPECTED_CHAIN_ID:\?set INDEXER_EXPECTED_CHAIN_ID\}/g,
      ),
    ).toHaveLength(2);
    expect(
      composeManifest.match(
        /INDEXER_EXPECTED_GENESIS_HASH=\$\{INDEXER_EXPECTED_GENESIS_HASH:\?set INDEXER_EXPECTED_GENESIS_HASH\}/g,
      ),
    ).toHaveLength(2);
  });

  it("wires one canonical contract namespace into both the API reconciler and indexer", () => {
    expect(
      composeManifest.match(
        /INDEXER_RPC_URL=\$\{INDEXER_RPC_URL:\?set INDEXER_RPC_URL\}/g,
      ),
    ).toHaveLength(2);
    expect(
      composeManifest.match(
        /CRUZIBLE_VAULT_ADDRESS=\$\{CRUZIBLE_VAULT_ADDRESS:\?set CRUZIBLE_VAULT_ADDRESS\}/g,
      ),
    ).toHaveLength(2);
    expect(
      composeManifest.match(
        /STAETHEL_ADDRESS=\$\{STAETHEL_ADDRESS:\?set STAETHEL_ADDRESS\}/g,
      ),
    ).toHaveLength(2);
    expect(
      composeManifest.match(
        /STABLECOIN_BRIDGE_ADDRESS=\$\{STABLECOIN_BRIDGE_ADDRESS:-\}/g,
      ),
    ).toHaveLength(2);
  });

  it("requires explicit drained indexer and legacy scheduler acknowledgements before migrations", () => {
    expect(composeManifest).toContain(
      "CRUZIBLE_MIGRATION_QUIESCED=${CRUZIBLE_MIGRATION_QUIESCED:?set true only after the indexer is stopped and drained}",
    );
    expect(composeManifest).toContain(
      "CRUZIBLE_LEGACY_SCHEDULERS_QUIESCED=${CRUZIBLE_LEGACY_SCHEDULERS_QUIESCED:?set true only after every old API scheduler is stopped and drained}",
    );
  });

  it("separates API auth validation from the indexer and keeps the testnet bridge optional", () => {
    expect(composeManifest).toContain("CRUZIBLE_RUNTIME_ROLE=api");
    expect(composeManifest).toContain("CRUZIBLE_RUNTIME_ROLE=indexer");
    expect(composeManifest).toContain(
      "AUTH_OPERATOR_ADDRESSES=${AUTH_OPERATOR_ADDRESSES:?set AUTH_OPERATOR_ADDRESSES}",
    );
    expect(composeManifest).toContain(
      "INDEXER_REQUIRE_STABLECOIN_BRIDGE=${INDEXER_REQUIRE_STABLECOIN_BRIDGE:-false}",
    );
    expect(composeManifest).not.toContain(
      "STABLECOIN_BRIDGE_ADDRESS=${STABLECOIN_BRIDGE_ADDRESS:?set STABLECOIN_BRIDGE_ADDRESS}",
    );
  });

  it("pins service images through required digest inputs", () => {
    expect(composeManifest).not.toContain(":latest");

    for (const variable of [
      "CRUZIBLE_API_IMAGE_DIGEST",
      "CRUZIBLE_INDEXER_IMAGE_DIGEST",
      "CRUZIBLE_MIGRATION_IMAGE_DIGEST",
      "POSTGRES_IMAGE_DIGEST",
      "NGINX_IMAGE_DIGEST",
      "PROMETHEUS_IMAGE_DIGEST",
      "GRAFANA_IMAGE_DIGEST",
      "JAEGER_IMAGE_DIGEST",
    ]) {
      expectRequiredVariable(variable);
    }
  });

  it("restarts a hung indexer using its process heartbeat watchdog", () => {
    expect(composeManifest).toContain(
      "INDEXER_HEARTBEAT_FILE=/tmp/cruzible-indexer-heartbeat.json",
    );
    expect(composeManifest).toContain("INDEXER_HEARTBEAT_MAX_AGE_MS=45000");
    expect(composeManifest).toContain(
      'test: ["CMD", "node", "dist/indexer-healthcheck.js"]',
    );
    expect(composeManifest).toContain("start_period: 90s");
    expect(composeManifest).toContain("retries: 4");
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
    for (const port of ["4001", "5432"]) {
      expect(composeManifest).not.toContain(`"${port}:${port}"`);
      expect(composeManifest).toContain(`"127.0.0.1:${port}:${port}"`);
    }

    expect(composeManifest).not.toContain('"127.0.0.1:6379:6379"');

    expect(composeManifest).toContain('"127.0.0.1:3002:3000"');
    expect(composeManifest).toContain('"127.0.0.1:16686:16686"');
    expect(composeManifest).toContain('"127.0.0.1:14250:14250"');
  });

  it("uses the canonical Cruzible backend port throughout the stack", () => {
    expect(composeManifest).toContain("PORT=4001");
    expect(composeManifest).toContain("http://localhost:4001/health/ready");
    expect(prometheusConfig).toContain("api-gateway:4001");
    expect(testnetComposeManifest).toContain('PORT: "4001"');
    expect(testnetComposeManifest).toContain(
      '"${CRUZIBLE_API_PORT:-4001}:4001"',
    );
  });

  it("pins API proxy trust to the nginx hop", () => {
    expect(composeManifest).toContain("TRUST_PROXY=1");
    expect(composeManifest).not.toContain("TRUST_PROXY=true");
  });

  it("uses the externally operated canonical chain instead of vendoring a node", () => {
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
