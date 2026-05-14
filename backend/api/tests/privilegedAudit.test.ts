import "reflect-metadata";
import express from "express";
import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHttpServer } from "./helpers/http";

vi.mock("../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from "../src/utils/logger";

const originalEnv = { ...process.env };
const OPERATIONAL_TOKEN = "12345678901234567890123456789012";

function registerTestInstance<T>(
  token: new (...args: never[]) => T,
  instance: T,
) {
  container.registerInstance(token, instance);
}

describe("privileged access audit logging", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    container.clearInstances();
    vi.resetModules();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    container.clearInstances();
    vi.resetModules();
  });

  it("logs successful wallet-gated privileged requests", async () => {
    const { config } = await import("../src/config");
    (config as any).authOperatorAddresses = ["aeth1operator"];

    const { authenticate, requireRoles } =
      await import("../src/auth/middleware");
    const { generateTokens } = await import("../src/auth/service");
    const { rateLimiter } = await import("../src/middleware/rateLimiter");
    const { accessToken } = generateTokens({
      address: "aeth1operator",
      roles: ["user", "operator"],
    });

    const app = express();
    app.use((req, res, next) => {
      req.requestId = "audit-wallet-success";
      res.setHeader("x-request-id", req.requestId);
      next();
    });
    app.use(rateLimiter);
    app.get("/ops", authenticate, requireRoles("operator"), (_req, res) => {
      res.json({ ok: true });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ops?access_token=secret`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(response.status).toBe(200);
      expect(logger.info).toHaveBeenCalledWith(
        "Privileged access audit",
        expect.objectContaining({
          type: "privileged_access_audit",
          requestId: "audit-wallet-success",
          method: "GET",
          path: "/ops",
          principalType: "wallet",
          actorAddress: "aeth1operator",
          requiredRoles: ["operator"],
          tokenRoles: ["user", "operator"],
          currentRoles: ["user", "operator"],
          decision: "allowed",
          outcome: "succeeded",
          statusCode: 200,
        }),
      );

      const { getMemoryPrivilegedAuditEvents } =
        await import("../src/middleware/privilegedAudit");
      const persistedEvents = getMemoryPrivilegedAuditEvents();

      expect(persistedEvents).toHaveLength(1);
      expect(persistedEvents[0]).toEqual(
        expect.objectContaining({
          requestId: "audit-wallet-success",
          method: "GET",
          path: "/ops",
          principalType: "wallet",
          actorAddress: "aeth1operator",
          requiredRoles: ["operator"],
          tokenRoles: ["user", "operator"],
          currentRoles: ["user", "operator"],
          decision: "allowed",
          outcome: "succeeded",
          statusCode: 200,
          previousEventHash: null,
        }),
      );
      expect(persistedEvents[0].eventHash).toMatch(/^[a-f0-9]{64}$/);
      expect(persistedEvents[0].ipHash).toMatch(/^[a-f0-9]{64}$/);
      expect(persistedEvents[0].userAgentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(persistedEvents[0])).not.toContain("secret");
    });
  });

  it("logs rejected wallet-gated requests before role checks run", async () => {
    const { authenticate, requireRoles } =
      await import("../src/auth/middleware");
    const { rateLimiter } = await import("../src/middleware/rateLimiter");

    const app = express();
    app.use((req, res, next) => {
      req.requestId = "audit-wallet-missing-token";
      res.setHeader("x-request-id", req.requestId);
      next();
    });
    app.use(rateLimiter);
    app.get("/ops", authenticate, requireRoles("operator"), (_req, res) => {
      res.json({ ok: true });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ops`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("www-authenticate")).toContain(
        'error="invalid_request"',
      );
      expect(body.requestId).toBe("audit-wallet-missing-token");
      expect(logger.warn).toHaveBeenCalledWith(
        "Privileged access audit",
        expect.objectContaining({
          type: "privileged_access_audit",
          requestId: "audit-wallet-missing-token",
          method: "GET",
          path: "/ops",
          principalType: "wallet",
          decision: "rejected",
          reason: "missing_authorization_header",
          outcome: "rejected",
          statusCode: 401,
        }),
      );

      const { getMemoryPrivilegedAuditEvents } =
        await import("../src/middleware/privilegedAudit");
      const persistedEvents = getMemoryPrivilegedAuditEvents();

      expect(persistedEvents).toHaveLength(1);
      expect(persistedEvents[0]).toEqual(
        expect.objectContaining({
          requestId: "audit-wallet-missing-token",
          method: "GET",
          path: "/ops",
          principalType: "wallet",
          actorAddress: null,
          decision: "rejected",
          reason: "missing_authorization_header",
          outcome: "rejected",
          statusCode: 401,
        }),
      );
    });
  });

  it("logs rejected production operational-token requests", async () => {
    const { config } = await import("../src/config");
    (config as any).isProduction = true;
    (config as any).operationalEndpointsToken = OPERATIONAL_TOKEN;

    const { requireOperationalAccess } =
      await import("../src/middleware/operationalAccess");
    const app = express();
    app.use((req, res, next) => {
      req.requestId = "audit-operational-reject";
      res.setHeader("x-request-id", req.requestId);
      next();
    });
    app.get("/metrics", requireOperationalAccess, (_req, res) => {
      res.type("text/plain").send("ok");
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/metrics`);

      expect(response.status).toBe(401);
      expect(logger.warn).toHaveBeenCalledWith(
        "Privileged access audit",
        expect.objectContaining({
          type: "privileged_access_audit",
          requestId: "audit-operational-reject",
          method: "GET",
          path: "/metrics",
          principalType: "operational-token",
          decision: "rejected",
          reason: "missing_or_invalid_operational_token",
          outcome: "rejected",
          statusCode: 401,
        }),
      );

      const { AlertService, AlertType } =
        await import("../src/services/AlertService");
      const alertService = container.resolve(AlertService);

      await expect
        .poll(async () => {
          const history = await alertService.getAlertHistory({
            type: AlertType.PRIVILEGED_ACCESS_REJECTED,
            limit: 10,
          });
          return history.total;
        })
        .toBe(1);

      const history = await alertService.getAlertHistory({
        type: AlertType.PRIVILEGED_ACCESS_REJECTED,
        limit: 10,
      });
      expect(history.data[0]).toMatchObject({
        severity: "WARNING",
        type: AlertType.PRIVILEGED_ACCESS_REJECTED,
        message: "Privileged access request rejected",
        metadata: expect.objectContaining({
          requestId: "audit-operational-reject",
          method: "GET",
          path: "/metrics",
          principalType: "operational-token",
          decision: "rejected",
          reason: "missing_or_invalid_operational_token",
          statusCode: 401,
        }),
      });
      expect(JSON.stringify(history.data[0])).not.toContain(OPERATIONAL_TOKEN);
    });
  });

  it("logs successful production operational-token requests", async () => {
    const { config } = await import("../src/config");
    (config as any).isProduction = true;
    (config as any).operationalEndpointsToken = OPERATIONAL_TOKEN;

    const { requireOperationalAccess } =
      await import("../src/middleware/operationalAccess");
    const app = express();
    app.use((req, res, next) => {
      req.requestId = "audit-operational-success";
      res.setHeader("x-request-id", req.requestId);
      next();
    });
    app.get("/metrics", requireOperationalAccess, (_req, res) => {
      res.type("text/plain").send("ok");
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/metrics`, {
        headers: { authorization: `Bearer ${OPERATIONAL_TOKEN}` },
      });

      expect(response.status).toBe(200);
      expect(logger.info).toHaveBeenCalledWith(
        "Privileged access audit",
        expect.objectContaining({
          type: "privileged_access_audit",
          requestId: "audit-operational-success",
          method: "GET",
          path: "/metrics",
          principalType: "operational-token",
          decision: "allowed",
          outcome: "succeeded",
          statusCode: 200,
        }),
      );
    });
  });

  it("flushes pending privileged audit tasks before shutdown cleanup", async () => {
    let resolveAlert!: () => void;
    const alertPromise = new Promise<void>((resolve) => {
      resolveAlert = resolve;
    });
    const { AlertService } = await import("../src/services/AlertService");
    registerTestInstance(AlertService, {
      sendAlert: vi.fn().mockReturnValue(alertPromise),
    } as unknown as AlertService);

    const {
      auditPrivilegedAccess,
      flushPendingPrivilegedAuditTasks,
      getPendingPrivilegedAuditTaskCount,
    } = await import("../src/middleware/privilegedAudit");
    const app = express();
    app.use((req, res, next) => {
      req.requestId = "audit-flush-pending";
      res.setHeader("x-request-id", req.requestId);
      next();
    });
    app.get("/ops", (req, res) => {
      auditPrivilegedAccess(req, res, {
        principalType: "operational-token",
        decision: "rejected",
        reason: "test_rejection",
      });
      res.status(401).json({ ok: false });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ops`);

      expect(response.status).toBe(401);
      expect(getPendingPrivilegedAuditTaskCount()).toBeGreaterThan(0);

      let flushed = false;
      const flushPromise = flushPendingPrivilegedAuditTasks().then(() => {
        flushed = true;
      });
      await Promise.resolve();

      expect(flushed).toBe(false);

      resolveAlert();
      await flushPromise;

      expect(flushed).toBe(true);
      expect(getPendingPrivilegedAuditTaskCount()).toBe(0);
    });
  });
});
