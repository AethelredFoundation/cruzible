/**
 * Stablecoin Routes — Integration Tests
 *
 * Tests the HTTP endpoints for stablecoin bridge data.
 * Uses the same pattern as routes.test.ts: register mock services,
 * mount the router on a real Express app, and test with HTTP.
 */

import "reflect-metadata";
import express from "express";
import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHttpServer } from "./helpers/http";

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../src/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function registerTestInstance<T>(
  token: new (...args: never[]) => T,
  instance: T,
) {
  container.registerInstance(token, instance);
}

const VALID_ASSET_ID =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

const MOCK_CONFIG = {
  assetId: VALID_ASSET_ID,
  symbol: "USDC",
  tokenAddress: "0x1234567890123456789012345678901234567890",
  routingType: 1,
  cctpDomain: 0,
  maxBridgeAmount: "1000000000000",
  dailyLimit: "500000000000",
  dailyUsed: "100000000000",
  circuitBreakerTripped: false,
  active: true,
  lastResetTimestamp: "2026-03-12T00:00:00.000Z",
  blockNumber: "1000",
};

const MOCK_EVENT = {
  id: "evt-1",
  assetId: VALID_ASSET_ID,
  eventType: "CCTPBurnInitiated",
  sender: "0xsender",
  amount: "1000000",
  destDomain: 0,
  txHash: "0xtxhash",
  blockNumber: "100",
  logIndex: 0,
  timestamp: "2026-03-11T12:00:00.000Z",
  metadata: { cctpNonce: "42" },
};

const MOCK_STATUS = {
  assetId: VALID_ASSET_ID,
  circuitBreakerTripped: false,
  dailyLimit: "500000000000",
  dailyUsed: "100000000000",
  dailyUsagePercent: 20,
  active: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stablecoin routes", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    container.clearInstances();
    (container as unknown as { reset?: () => void }).reset?.();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function mountRouter() {
    const { CacheService } = await import("../src/services/CacheService");
    const { StablecoinBridgeService } =
      await import("../src/services/StablecoinBridgeService");

    const mockCache = {
      get: vi.fn().mockReturnValue(null), // No cache hits by default
      set: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    const mockService = {
      getConfigs: vi.fn().mockResolvedValue([MOCK_CONFIG]),
      getConfig: vi.fn().mockResolvedValue(MOCK_CONFIG),
      getBridgeHistory: vi.fn().mockResolvedValue({
        data: [MOCK_EVENT],
        pagination: { total: 1, limit: 50, offset: 0 },
      }),
      getStatus: vi.fn().mockResolvedValue(MOCK_STATUS),
    };

    registerTestInstance(CacheService, mockCache as any);
    registerTestInstance(StablecoinBridgeService, mockService as any);

    const { stablecoinsRouter } = await import("../src/routes/v1/stablecoins");

    const app = express();
    app.use(express.json());
    app.use("/v1/stablecoins", stablecoinsRouter);

    // Error handler for ApiError
    app.use((err: any, _req: any, res: any, _next: any) => {
      const status = err.statusCode || err.status || 500;
      res.status(status).json({
        error: err.message || "Internal Server Error",
        details: err.details || undefined,
      });
    });

    return { app, mockService, mockCache };
  }

  // -----------------------------------------------------------------------
  // GET /v1/stablecoins
  // -----------------------------------------------------------------------

  it("GET /v1/stablecoins returns configs list", async () => {
    const { app } = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/stablecoins`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].symbol).toBe("USDC");
      expect(body.data[0].routingType).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // GET /v1/stablecoins/:assetId
  // -----------------------------------------------------------------------

  it("GET /v1/stablecoins/:assetId returns a single config", async () => {
    const { app } = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/stablecoins/${VALID_ASSET_ID}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.assetId).toBe(VALID_ASSET_ID);
      expect(body.data.symbol).toBe("USDC");
    });
  });

  it("GET /v1/stablecoins/:assetId rejects invalid assetId format", async () => {
    const { app } = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/stablecoins/not-a-hex-string`);

      expect(res.status).toBe(400);
    });
  });

  it("GET /v1/stablecoins/:assetId returns 404 when not found", async () => {
    const { app, mockService } = await mountRouter();
    mockService.getConfig.mockResolvedValue(null);

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/stablecoins/${VALID_ASSET_ID}`);

      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // GET /v1/stablecoins/:assetId/history
  // -----------------------------------------------------------------------

  it("GET /v1/stablecoins/:assetId/history returns paginated events", async () => {
    const { app } = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/v1/stablecoins/${VALID_ASSET_ID}/history?limit=10&offset=0`,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].eventType).toBe("CCTPBurnInitiated");
      expect(body.pagination).toBeDefined();
    });
  });

  it("GET /v1/stablecoins/:assetId/history accepts event_type filter", async () => {
    const { app, mockService } = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/v1/stablecoins/${VALID_ASSET_ID}/history?event_type=CCTPBurnInitiated`,
      );

      expect(res.status).toBe(200);
      expect(mockService.getBridgeHistory).toHaveBeenCalledWith(
        VALID_ASSET_ID,
        expect.objectContaining({ eventType: "CCTPBurnInitiated" }),
      );
    });
  });

  it("GET /v1/stablecoins/:assetId/history rejects invalid event_type", async () => {
    const { app } = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/v1/stablecoins/${VALID_ASSET_ID}/history?event_type=InvalidType`,
      );

      expect(res.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // GET /v1/stablecoins/:assetId/status
  // -----------------------------------------------------------------------

  it("GET /v1/stablecoins/:assetId/status returns status data", async () => {
    const { app } = await mountRouter();

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/v1/stablecoins/${VALID_ASSET_ID}/status`,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.assetId).toBe(VALID_ASSET_ID);
      expect(body.data.circuitBreakerTripped).toBe(false);
      expect(body.data.dailyUsagePercent).toBe(20);
    });
  });

  it("GET /v1/stablecoins/:assetId/status returns 404 when not found", async () => {
    const { app, mockService } = await mountRouter();
    mockService.getStatus.mockResolvedValue(null);

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/v1/stablecoins/${VALID_ASSET_ID}/status`,
      );

      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Caching
  // -----------------------------------------------------------------------

  it("serves cached response when available", async () => {
    const { app, mockService, mockCache } = await mountRouter();

    // Simulate cache hit
    mockCache.get.mockReturnValue({ data: [MOCK_CONFIG] });

    await withHttpServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/v1/stablecoins`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(1);

      // Service should NOT have been called — cache was hit
      expect(mockService.getConfigs).not.toHaveBeenCalled();
    });
  });
});
