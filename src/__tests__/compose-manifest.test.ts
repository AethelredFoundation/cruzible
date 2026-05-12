import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const composeManifest = readFileSync(
  resolve(process.cwd(), "backend/infra/docker-compose.yml"),
  "utf8",
);

function expectRequiredVariable(variable: string) {
  expect(composeManifest).toContain(`\${${variable}:?set ${variable}}`);
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
    expectRequiredVariable("RPC_URL");
    expectRequiredVariable("GRPC_URL");
    expectRequiredVariable("CORS_ORIGINS");
    expectRequiredVariable("JWT_SECRET_FILE");
    expectRequiredVariable("JWT_REFRESH_SECRET_FILE");
    expectRequiredVariable("OPERATIONAL_ENDPOINTS_TOKEN_FILE");
    expectRequiredVariable("GRAFANA_USER");
    expectRequiredVariable("GRAFANA_PASSWORD_FILE");
  });

  it("mounts high-value credentials through Docker secrets", () => {
    for (const secretName of [
      "cruzible_database_url",
      "cruzible_db_password",
      "cruzible_jwt_secret",
      "cruzible_jwt_refresh_secret",
      "cruzible_operational_token",
      "cruzible_grafana_password",
    ]) {
      expect(composeManifest).toContain(`${secretName}:`);
      expect(composeManifest).toContain(`- ${secretName}`);
    }

    expect(composeManifest).toContain(
      "DATABASE_URL_FILE=/run/secrets/cruzible_database_url",
    );
    expect(composeManifest).toContain(
      "JWT_SECRET_FILE=/run/secrets/cruzible_jwt_secret",
    );
    expect(composeManifest).toContain(
      "JWT_REFRESH_SECRET_FILE=/run/secrets/cruzible_jwt_refresh_secret",
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

  it("requires explicit indexer chain identity for production indexing", () => {
    expect(composeManifest).toContain(
      "INDEXER_EXPECTED_CHAIN_ID=${INDEXER_EXPECTED_CHAIN_ID:?set INDEXER_EXPECTED_CHAIN_ID}",
    );
  });

  it("pins third-party service images through required digest inputs", () => {
    expect(composeManifest).not.toContain(":latest");

    for (const variable of [
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

  it("keeps internal service ports off public host interfaces", () => {
    for (const port of ["3000", "5432", "6379"]) {
      expect(composeManifest).not.toContain(`"${port}:${port}"`);
      expect(composeManifest).toContain(`"127.0.0.1:${port}:${port}"`);
    }

    expect(composeManifest).toContain('"127.0.0.1:3002:3000"');
    expect(composeManifest).toContain('"127.0.0.1:16686:16686"');
    expect(composeManifest).toContain('"127.0.0.1:14250:14250"');
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
