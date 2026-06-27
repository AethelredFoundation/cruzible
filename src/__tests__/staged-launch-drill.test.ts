import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStagedLaunchDrillPlan,
  parseStagedLaunchDrillArgs,
  runStagedLaunchDrill,
} from "../../scripts/staged-launch-drill.mjs";

function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const normalizedHeaders = new Map(
    Object.entries({
      "content-type":
        typeof body === "string"
          ? "text/html; charset=utf-8"
          : "application/json",
      ...headers,
    }).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function createRepositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), "cruzible-launch-drill-"));
  const requiredFiles = [
    "docs/ops/runbook.md",
    "docs/ops/disaster-recovery-targets.json",
    "docs/ops/environment-reference.md",
    "docs/architecture/12-public-readiness.md",
    "docs/architecture/13-production-gap-register.md",
    "backend/infra/docker-compose.yml",
    "k8s/base/kustomization.yaml",
    "k8s/base/network-policy.yaml",
    "k8s/overlays/production-egress/kustomization.yaml",
    "k8s/overlays/production-egress/network-policy-egress-allowlist.yaml",
    "backend/contracts/deployments/release-manifest.example.json",
    "scripts/validate-deployment-manifests.mjs",
    "scripts/check-frontend-bundle-budget.mjs",
  ];

  for (const filePath of requiredFiles) {
    const absolutePath = join(root, filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, "evidence");
  }

  return root;
}

describe("staged launch drill", () => {
  it("parses dry-run and staging URL options without accepting token values", () => {
    const options = parseStagedLaunchDrillArgs([
      "--dry-run",
      "--frontend-url",
      "https://staging.cruzible.example",
      "--api-url",
      "https://api.staging.cruzible.example",
      "--operational-token-env",
      "STAGING_OPS_TOKEN",
      "--operator-token-env",
      "STAGING_OPERATOR_TOKEN",
      "--timeout-ms",
      "7000",
    ]);

    expect(options).toMatchObject({
      apiUrl: "https://api.staging.cruzible.example",
      dryRun: true,
      frontendUrl: "https://staging.cruzible.example",
      operationalTokenEnv: "STAGING_OPS_TOKEN",
      operatorTokenEnv: "STAGING_OPERATOR_TOKEN",
      timeoutMs: 7000,
    });
  });

  it("builds a dry-run plan with required checks and no secret leakage", () => {
    const plan = buildStagedLaunchDrillPlan({
      env: {
        NODE_ENV: "test",
        OPERATIONAL_ENDPOINTS_TOKEN: "staging-ops-secret-should-not-appear",
        STAGING_OPERATOR_BEARER_TOKEN: "operator-jwt-should-not-appear",
      },
      options: {
        apiUrl: "https://api.staging.cruzible.example",
        dryRun: true,
        frontendUrl: "https://staging.cruzible.example",
      },
    });
    const serialized = JSON.stringify(plan);

    expect(plan.mode).toBe("dry-run");
    expect(plan.configuration.operationalTokenPresent).toBe(true);
    expect(plan.configuration.operatorTokenPresent).toBe(true);
    expect(plan.checks.map((check) => check.id)).toContain("api-ready");
    expect(plan.checks.map((check) => check.id)).toContain(
      "api-full-health-rejects-anonymous",
    );
    expect(serialized).not.toContain("staging-ops-secret-should-not-appear");
    expect(serialized).not.toContain("operator-jwt-should-not-appear");
  });

  it("rejects live API bases that already include the public /v1 prefix", () => {
    const plan = buildStagedLaunchDrillPlan({
      options: {
        apiUrl: "https://api.staging.cruzible.example/v1",
        dryRun: false,
        frontendUrl: "https://staging.cruzible.example",
      },
    });

    expect(plan.validationErrors).toContain(
      "API URL should point at the API origin, not the /v1 route prefix.",
    );
  });

  it("runs live checks with sanitized operational and operator credentials", async () => {
    const calls: Array<{ headers: Record<string, string>; url: string }> = [];
    const result = await runStagedLaunchDrill({
      env: {
        NODE_ENV: "test",
        OPERATIONAL_ENDPOINTS_TOKEN: "staging-ops-secret-should-not-appear",
        STAGING_OPERATOR_BEARER_TOKEN: "operator-jwt-should-not-appear",
      },
      fetchImpl: (async (
        url: string | URL | Request,
        init?: { headers?: Record<string, string> },
      ) => {
        const requestUrl = url.toString();
        calls.push({ headers: init?.headers ?? {}, url: requestUrl });
        const parsedUrl = new URL(requestUrl);
        const path = `${parsedUrl.pathname}${parsedUrl.search}`;

        if (path === "/api/health") {
          return fakeResponse(
            200,
            { service: "cruzible-frontend", status: "ok" },
            { "cache-control": "no-store" },
          );
        }
        if (["/", "/vault", "/reconciliation", "/governance"].includes(path)) {
          return fakeResponse(200, "<html>Cruzible</html>");
        }
        if (path === "/health/live") {
          return fakeResponse(200, { ok: true });
        }
        if (path === "/health/ready") {
          return fakeResponse(200, { ready: true });
        }
        if (path === "/health") {
          return init?.headers?.["x-operational-token"]
            ? fakeResponse(200, { service: "cruzible-api", status: "healthy" })
            : fakeResponse(401, { error: "Unauthorized" });
        }
        if (path === "/metrics" || path === "/docs") {
          return fakeResponse(401, { error: "Unauthorized" });
        }
        if (path === "/v1/reconciliation/live?validator_limit=50") {
          return fakeResponse(200, { status: "OK" });
        }
        if (path === "/v1/reconciliation/status") {
          return init?.headers?.authorization
            ? fakeResponse(200, { status: "OK" })
            : fakeResponse(401, { error: "Unauthorized" });
        }
        if (path === "/v1/alerts/summary") {
          return fakeResponse(200, { activeCritical: 0 });
        }

        return fakeResponse(404, { error: "not found" });
      }) as unknown as typeof fetch,
      options: {
        apiUrl: "https://api.staging.cruzible.example",
        dryRun: false,
        frontendUrl: "https://staging.cruzible.example",
      },
    });
    const serialized = JSON.stringify(result);

    expect(result.status).toBe("passed");
    expect(result.summary.failed).toBe(0);
    expect(calls.some((call) => call.headers["x-operational-token"])).toBe(
      true,
    );
    expect(calls.some((call) => call.headers.authorization)).toBe(true);
    expect(serialized).not.toContain("staging-ops-secret-should-not-appear");
    expect(serialized).not.toContain("operator-jwt-should-not-appear");
  });

  it("fails live mode before network calls when required inputs are missing", async () => {
    const result = await runStagedLaunchDrill({
      env: { NODE_ENV: "test" },
      fetchImpl: (async () => {
        throw new Error("network should not be called");
      }) as unknown as typeof fetch,
      options: {
        apiUrl: "https://api.staging.cruzible.example",
        dryRun: false,
      },
    });

    expect(result.status).toBe("failed");
    expect(result.missingInputs).toContain(
      "STAGING_FRONTEND_URL or --frontend-url",
    );
    expect(result.missingInputs).toContain("OPERATIONAL_ENDPOINTS_TOKEN");
  });

  it("reports missing repository evidence in the drill plan", () => {
    const root = createRepositoryFixture();
    rmSync(join(root, "k8s/base/network-policy.yaml"), { force: true });

    try {
      const plan = buildStagedLaunchDrillPlan({
        cwd: root,
        options: { dryRun: true },
      });

      expect(plan.validationErrors).toContain(
        "Required repository evidence is missing: k8s/base/network-policy.yaml",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
