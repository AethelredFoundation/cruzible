import { describe, expect, it } from "vitest";
import { swaggerSpec } from "../src/config/swagger";
import {
  discoverExpressRoutes,
  validateOpenApiCoverage,
} from "../scripts/validate-openapi-coverage.mjs";

describe("OpenAPI coverage", () => {
  it("documents every mounted /v1 route", () => {
    const result = validateOpenApiCoverage();

    expect(result.errors).toEqual([]);
    expect(result.expressRoutes.length).toBeGreaterThanOrEqual(30);
    expect(result.openApiRoutes).toHaveLength(result.expressRoutes.length);
  });

  it("serves the route manifest through the Swagger spec", () => {
    const documentedRouteCount = Object.values(swaggerSpec.paths).reduce(
      (count, operations) => count + Object.keys(operations).length,
      0,
    );

    expect(swaggerSpec.paths).toHaveProperty("/v1/auth/login");
    expect(swaggerSpec.paths).toHaveProperty(
      "/v1/stablecoins/{assetId}/status",
    );
    expect(documentedRouteCount).toBe(discoverExpressRoutes().length);
  });
});
