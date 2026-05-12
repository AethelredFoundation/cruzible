import "reflect-metadata";
import { lookup } from "node:dns/promises";
import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const originalEnv = { ...process.env };
const lookupMock = vi.mocked(lookup);

function productionWebhookEnv(): NodeJS.ProcessEnv {
  return {
    ...originalEnv,
    NODE_ENV: "production",
    RPC_URL: "https://rpc.cruzible.test",
    DATABASE_URL: "postgresql://cruzible:secret@db.cruzible.test:5432/cruzible",
    REDIS_URL: "redis://cache.cruzible.test:6379",
    CORS_ORIGINS: "https://vault.cruzible.test",
    JWT_SECRET: "s".repeat(32),
    JWT_REFRESH_SECRET: "r".repeat(32),
    AUTH_OPERATOR_ADDRESSES: "aeth1operator00000",
    INDEXER_ENABLED: "false",
    ALERT_RATE_LIMIT_MS: "60000",
    ALERT_WEBHOOK_URL: "https://alerts.cruzible.test/hook",
    AUTH_EXPOSE_REFRESH_TOKEN_IN_BODY: "false",
  };
}

describe("AlertService", () => {
  beforeEach(() => {
    container.clearInstances();
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ALERT_RATE_LIMIT_MS: "60000",
    };
    delete process.env.DATABASE_URL;
    delete process.env.ALERT_WEBHOOK_URL;
    lookupMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    container.clearInstances();
    vi.resetModules();
  });

  it("stores alert history and summaries in the local fallback buffer", async () => {
    const { AlertService, AlertSeverity, AlertType } =
      await import("../src/services/AlertService");
    const service = new AlertService();

    const alert = await service.sendAlert(
      AlertSeverity.CRITICAL,
      AlertType.EXCHANGE_RATE_DRIFT,
      "Exchange rate drift exceeded threshold",
      { drift: 0.08 },
    );

    const history = await service.getAlertHistory({ limit: 10 });
    const summary = await service.getAlertSummary();
    const activeCritical = await service.getActiveCriticalCount();

    expect(alert?.delivered).toBe(true);
    expect(alert?.id).toMatch(
      /^alert_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(history.total).toBe(1);
    expect(history.data[0]).toMatchObject({
      severity: AlertSeverity.CRITICAL,
      type: AlertType.EXCHANGE_RATE_DRIFT,
      metadata: { drift: 0.08 },
    });
    expect(summary.activeCritical).toBe(1);
    expect(activeCritical).toBe(1);
    expect(summary.byType[AlertType.PRIVILEGED_ACCESS_REJECTED]).toBe(0);
  });

  it("rate-limits duplicate alert categories", async () => {
    const { AlertService, AlertSeverity, AlertType } =
      await import("../src/services/AlertService");
    const service = new AlertService();

    const first = await service.sendAlert(
      AlertSeverity.WARNING,
      AlertType.TVL_ANOMALY,
      "TVL warning",
    );
    const second = await service.sendAlert(
      AlertSeverity.WARNING,
      AlertType.TVL_ANOMALY,
      "TVL warning replay",
    );

    const history = await service.getAlertHistory();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(history.total).toBe(1);
  });

  it("uses a shared container instance for fallback alert history", async () => {
    const { AlertService, AlertSeverity, AlertType } =
      await import("../src/services/AlertService");

    const sender = container.resolve(AlertService);
    const reader = container.resolve(AlertService);

    await sender.sendAlert(
      AlertSeverity.WARNING,
      AlertType.PRIVILEGED_ACCESS_REJECTED,
      "Privileged access request rejected",
      { requestId: "shared-alert-history" },
    );

    const history = await reader.getAlertHistory({
      type: AlertType.PRIVILEGED_ACCESS_REJECTED,
      limit: 10,
    });

    expect(sender).toBe(reader);
    expect(history.total).toBe(1);
    expect(history.data[0].metadata).toMatchObject({
      requestId: "shared-alert-history",
    });
  });

  it("posts configured webhooks without following redirects", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://alerts.cruzible.test/hook";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { AlertService, AlertSeverity, AlertType } =
      await import("../src/services/AlertService");
    const service = new AlertService();

    try {
      await service.sendAlert(
        AlertSeverity.CRITICAL,
        AlertType.RECONCILIATION_MISMATCH,
        "Reconciliation mismatch",
        { epoch: 42 },
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(String(init?.body));

      expect(url).toBe("https://alerts.cruzible.test/hook");
      expect(init).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(body).toMatchObject({
        severity: AlertSeverity.CRITICAL,
        type: AlertType.RECONCILIATION_MISMATCH,
        message: "Reconciliation mismatch",
        metadata: { epoch: 42 },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("blocks production webhooks that resolve to private addresses before fetch", async () => {
    process.env = productionWebhookEnv();
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { AlertService, AlertSeverity, AlertType } =
      await import("../src/services/AlertService");
    const service = new AlertService();
    (service as unknown as { prisma: null }).prisma = null;

    try {
      await service.sendAlert(
        AlertSeverity.CRITICAL,
        AlertType.RECONCILIATION_MISMATCH,
        "Reconciliation mismatch",
      );

      expect(lookupMock).toHaveBeenCalledWith("alerts.cruzible.test", {
        all: true,
        verbatim: true,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
