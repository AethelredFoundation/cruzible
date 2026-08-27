import "reflect-metadata";
import express from "express";
import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHttpServer } from "./helpers/http";

const originalEnv = { ...process.env };

function registerTestInstance<T>(
  token: new (...args: never[]) => T,
  instance: T,
) {
  container.registerInstance(token, instance);
}

describe("alert routes", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    container.clearInstances();
    (container as unknown as { reset?: () => void }).reset?.();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function buildAlertsApp() {
    const { config } = await import("../src/config");
    (config as any).authOperatorAddresses = ["aeth1operator"];
    (config as any).authAdminAddresses = [];

    const { AlertService } = await import("../src/services/AlertService");
    const { ReconciliationScheduler } =
      await import("../src/services/ReconciliationScheduler");

    const alerts = {
      getAlertHistory: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getAlertSummary: vi
        .fn()
        .mockResolvedValue({ critical: 0, warning: 0, info: 0 }),
    } as unknown as AlertService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue({
        status: "GREEN",
        epoch: 42,
        timestamp: "2026-05-13T00:00:00.000Z",
      }),
    } as unknown as ReconciliationScheduler;

    registerTestInstance(AlertService, alerts);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);

    const { generateTokens } = await import("../src/auth/service");
    const { alertsRouter, reconciliationStatusRouter } =
      await import("../src/routes/v1/alerts");
    const { errorHandler } = await import("../src/middleware/errorHandler");

    const operatorToken = generateTokens({
      address: "aeth1operator",
      roles: ["user", "operator"],
    }).accessToken;

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.requestId = req.get("x-request-id") ?? "alert-route-test";
      res.setHeader("x-request-id", req.requestId);
      next();
    });
    app.use("/v1/alerts", alertsRouter);
    app.use("/v1/reconciliation", reconciliationStatusRouter);
    app.use(errorHandler);

    return { app, operatorToken };
  }

  it("marks operator alert and reconciliation responses as non-cacheable", async () => {
    const { app, operatorToken } = await buildAlertsApp();

    await withHttpServer(app, async (baseUrl) => {
      const headers = { Authorization: `Bearer ${operatorToken}` };
      const alertList = await fetch(`${baseUrl}/v1/alerts?limit=10`, {
        headers,
      });
      const alertSummary = await fetch(`${baseUrl}/v1/alerts/summary`, {
        headers,
      });
      const reconciliationStatus = await fetch(
        `${baseUrl}/v1/reconciliation/status`,
        { headers },
      );

      expect(alertList.status).toBe(200);
      expect(alertList.headers.get("cache-control")).toBe("no-store");
      expect(alertSummary.status).toBe(200);
      expect(alertSummary.headers.get("cache-control")).toBe("no-store");
      expect(reconciliationStatus.status).toBe(200);
      expect(reconciliationStatus.headers.get("cache-control")).toBe(
        "no-store",
      );
    });
  });
});
