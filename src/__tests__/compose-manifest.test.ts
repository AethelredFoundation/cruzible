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
    expect(composeManifest).not.toContain(
      "GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD:-admin}",
    );
    expect(composeManifest).not.toContain("CORS_ORIGINS=${CORS_ORIGINS:-");

    expectRequiredVariable("DB_USER");
    expectRequiredVariable("DB_PASSWORD");
    expectRequiredVariable("DB_NAME");
    expectRequiredVariable("CORS_ORIGINS");
    expectRequiredVariable("GRAFANA_USER");
    expectRequiredVariable("GRAFANA_PASSWORD");
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
    for (const port of ["3000", "5432", "6379", "1317", "26657", "9091"]) {
      expect(composeManifest).not.toContain(`"${port}:${port}"`);
      expect(composeManifest).toContain(`"127.0.0.1:${port}:${port}"`);
    }

    expect(composeManifest).toContain('"26656:26656"');
    expect(composeManifest).toContain('"127.0.0.1:9090:9090"');
    expect(composeManifest).toContain('"127.0.0.1:3002:3000"');
    expect(composeManifest).toContain('"127.0.0.1:16686:16686"');
    expect(composeManifest).toContain('"127.0.0.1:14250:14250"');
  });
});
