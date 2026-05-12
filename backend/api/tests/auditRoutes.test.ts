import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHttpServer } from "./helpers/http";

const originalEnv = { ...process.env };

describe("audit routes", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function buildAuditApp() {
    const { config } = await import("../src/config");
    (config as any).authOperatorAddresses = ["aeth1operator"];
    (config as any).authAdminAddresses = [];

    const { authenticate, requireRoles } =
      await import("../src/auth/middleware");
    const { generateTokens } = await import("../src/auth/service");
    const { rateLimiter } = await import("../src/middleware/rateLimiter");
    const { auditRouter } = await import("../src/routes/v1/audit");
    const { errorHandler } = await import("../src/middleware/errorHandler");
    const { clearMemoryPrivilegedAuditEvents } =
      await import("../src/middleware/privilegedAudit");
    clearMemoryPrivilegedAuditEvents();

    const operatorToken = generateTokens({
      address: "aeth1operator",
      roles: ["user", "operator"],
    }).accessToken;
    const userToken = generateTokens({
      address: "aeth1user",
      roles: ["user"],
    }).accessToken;

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.requestId = req.get("x-request-id") ?? "audit-route-test";
      res.setHeader("x-request-id", req.requestId);
      next();
    });
    app.get(
      "/ops",
      rateLimiter,
      authenticate,
      requireRoles("operator"),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    app.use("/v1/audit", auditRouter);
    app.use(errorHandler);

    return { app, operatorToken, userToken };
  }

  it("lists sanitized privileged audit evidence for operators", async () => {
    const { app, operatorToken } = await buildAuditApp();

    await withHttpServer(app, async (baseUrl) => {
      const auditSource = await fetch(`${baseUrl}/ops?access_token=secret`, {
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "User-Agent": "AuditRouteTest/1.0",
          "X-Request-ID": "source-request",
        },
      });
      expect(auditSource.status).toBe(200);

      const response = await fetch(
        `${baseUrl}/v1/audit/privileged-access?limit=10`,
        {
          headers: {
            Authorization: `Bearer ${operatorToken}`,
            "X-Request-ID": "audit-list-request",
          },
        },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body.pagination).toMatchObject({
        limit: 10,
        offset: 0,
        total: 1,
        hasMore: false,
      });
      expect(body.data[0]).toEqual(
        expect.objectContaining({
          requestId: "source-request",
          method: "GET",
          path: "/ops",
          principalType: "wallet",
          actorAddress: "aeth1operator",
          decision: "allowed",
          outcome: "succeeded",
          statusCode: 200,
        }),
      );
      expect(body.data[0].eventHash).toMatch(/^[a-f0-9]{64}$/);
      expect(body.data[0].ipHash).toMatch(/^[a-f0-9]{64}$/);
      expect(body.data[0].userAgentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(body)).not.toContain("secret");
      expect(JSON.stringify(body)).not.toContain("AuditRouteTest/1.0");
    });
  });

  it("exports privileged audit evidence as NDJSON", async () => {
    const { app, operatorToken } = await buildAuditApp();

    await withHttpServer(app, async (baseUrl) => {
      const auditSource = await fetch(`${baseUrl}/ops`, {
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "X-Request-ID": "export-source-request",
        },
      });
      expect(auditSource.status).toBe(200);

      const response = await fetch(
        `${baseUrl}/v1/audit/privileged-access/export?format=ndjson&limit=10`,
        {
          headers: { Authorization: `Bearer ${operatorToken}` },
        },
      );
      const body = await response.text();
      const lines = body.trim().split("\n");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/x-ndjson",
      );
      expect(response.headers.get("content-disposition")).toContain(
        "privileged-audit.ndjson",
      );
      expect(JSON.parse(lines[0])).toMatchObject({
        requestId: "export-source-request",
        path: "/ops",
        decision: "allowed",
      });
    });
  });

  it("neutralizes spreadsheet formulas in CSV exports", async () => {
    const { app, operatorToken } = await buildAuditApp();

    await withHttpServer(app, async (baseUrl) => {
      const auditSource = await fetch(`${baseUrl}/ops`, {
        headers: {
          Authorization: `Bearer ${operatorToken}`,
          "X-Request-ID": '=HYPERLINK("https://example.invalid","x")',
        },
      });
      expect(auditSource.status).toBe(200);

      const response = await fetch(
        `${baseUrl}/v1/audit/privileged-access/export?format=csv&limit=10`,
        {
          headers: { Authorization: `Bearer ${operatorToken}` },
        },
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
      expect(body).toContain(
        `"'=HYPERLINK(""https://example.invalid"",""x"")"`,
      );
    });
  });

  it("rejects audit retrieval for non-operators", async () => {
    const { app, userToken } = await buildAuditApp();

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/audit/privileged-access`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.message).toContain("Insufficient permissions");
    });
  });

  it("rejects unbounded audit pagination offsets", async () => {
    const { app, operatorToken } = await buildAuditApp();

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/audit/privileged-access?offset=10001`,
        {
          headers: { Authorization: `Bearer ${operatorToken}` },
        },
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.message).toBe("Validation failed");
      expect(JSON.stringify(body.details)).toContain("10000");
    });
  });
});
