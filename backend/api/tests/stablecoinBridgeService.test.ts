/**
 * StablecoinBridgeService — Unit Tests
 *
 * Tests the read-only service layer that serves stablecoin
 * configuration and bridge event data from the database.
 */

import "reflect-metadata";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { StablecoinBridgeService } from "../src/services/StablecoinBridgeService";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    stablecoinConfig: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    stablecoinBridgeEvent: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StablecoinBridgeService", () => {
  let service: StablecoinBridgeService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    // Construct the service with the mock Prisma client
    service = new StablecoinBridgeService(mockPrisma as any);
  });

  // -------------------------------------------------------------------------
  // getConfigs()
  // -------------------------------------------------------------------------

  describe("getConfigs()", () => {
    it("returns mapped config DTOs sorted by symbol", async () => {
      const mockConfigs = [
        {
          id: "uuid-1",
          assetId:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          symbol: "USDC",
          tokenAddress: "0x1234567890123456789012345678901234567890",
          routingType: 1,
          cctpDomain: 0,
          maxBridgeAmount: "1000000000000",
          dailyLimit: "500000000000",
          dailyUsed: "100000000000",
          circuitBreakerTripped: false,
          active: true,
          lastResetTimestamp: new Date("2026-03-12T00:00:00Z"),
          blockNumber: BigInt(1000),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.stablecoinConfig.findMany.mockResolvedValue(mockConfigs);

      const result = await service.getConfigs();

      expect(result).toHaveLength(1);
      expect(result[0].assetId).toBe(mockConfigs[0].assetId);
      expect(result[0].symbol).toBe("USDC");
      expect(result[0].routingType).toBe(1);
      expect(result[0].active).toBe(true);
      expect(result[0].circuitBreakerTripped).toBe(false);
      expect(result[0].blockNumber).toBe("1000"); // BigInt → string
      expect(result[0].lastResetTimestamp).toBe("2026-03-12T00:00:00.000Z");
    });

    it("returns empty array when no configs exist", async () => {
      mockPrisma.stablecoinConfig.findMany.mockResolvedValue([]);

      const result = await service.getConfigs();

      expect(result).toEqual([]);
    });

    it("propagates database errors", async () => {
      mockPrisma.stablecoinConfig.findMany.mockRejectedValue(
        new Error("Connection refused"),
      );

      await expect(service.getConfigs()).rejects.toThrow("Connection refused");
    });
  });

  // -------------------------------------------------------------------------
  // getConfig(assetId)
  // -------------------------------------------------------------------------

  describe("getConfig()", () => {
    it("returns a single config DTO", async () => {
      const mockConfig = {
        id: "uuid-1",
        assetId: "0xabcd",
        symbol: "USDT",
        tokenAddress: "0x9999",
        routingType: 1,
        cctpDomain: null,
        maxBridgeAmount: "0",
        dailyLimit: "0",
        dailyUsed: "0",
        circuitBreakerTripped: false,
        active: false,
        lastResetTimestamp: null,
        blockNumber: BigInt(500),
        updatedAt: new Date(),
      };

      mockPrisma.stablecoinConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await service.getConfig("0xabcd");

      expect(result).not.toBeNull();
      expect(result!.assetId).toBe("0xabcd");
      expect(result!.symbol).toBe("USDT");
      expect(result!.lastResetTimestamp).toBeNull();
      expect(result!.blockNumber).toBe("500");
    });

    it("returns null when config not found", async () => {
      mockPrisma.stablecoinConfig.findUnique.mockResolvedValue(null);

      const result = await service.getConfig("0xnonexistent");

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getBridgeHistory(assetId, options)
  // -------------------------------------------------------------------------

  describe("getBridgeHistory()", () => {
    it("returns paginated bridge events", async () => {
      const mockEvents = [
        {
          id: "evt-1",
          assetId: "0xabcd",
          eventType: "CCTPBurnInitiated",
          sender: "0xsender",
          amount: "1000000",
          destDomain: 0,
          txHash: "0xtxhash",
          blockNumber: BigInt(100),
          logIndex: 0,
          timestamp: new Date("2026-03-11T12:00:00Z"),
          metadata: { cctpNonce: "42" },
        },
      ];

      mockPrisma.stablecoinBridgeEvent.findMany.mockResolvedValue(mockEvents);
      mockPrisma.stablecoinBridgeEvent.count.mockResolvedValue(1);

      const result = await service.getBridgeHistory("0xabcd", {
        limit: 50,
        offset: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].eventType).toBe("CCTPBurnInitiated");
      expect(result.data[0].blockNumber).toBe("100"); // BigInt → string
      expect(result.data[0].timestamp).toBe("2026-03-11T12:00:00.000Z");
      expect(result.pagination).toEqual({ total: 1, limit: 50, offset: 0 });
    });

    it("filters by eventType when provided", async () => {
      mockPrisma.stablecoinBridgeEvent.findMany.mockResolvedValue([]);
      mockPrisma.stablecoinBridgeEvent.count.mockResolvedValue(0);

      await service.getBridgeHistory("0xabcd", {
        limit: 10,
        offset: 0,
        eventType: "MintExecuted",
      });

      // Verify the where clause includes eventType
      const findManyCall =
        mockPrisma.stablecoinBridgeEvent.findMany.mock.calls[0][0];
      expect(findManyCall.where.eventType).toBe("MintExecuted");
    });

    it("respects limit and offset", async () => {
      mockPrisma.stablecoinBridgeEvent.findMany.mockResolvedValue([]);
      mockPrisma.stablecoinBridgeEvent.count.mockResolvedValue(100);

      const result = await service.getBridgeHistory("0xabcd", {
        limit: 10,
        offset: 20,
      });

      expect(result.pagination).toEqual({ total: 100, limit: 10, offset: 20 });

      const findManyCall =
        mockPrisma.stablecoinBridgeEvent.findMany.mock.calls[0][0];
      expect(findManyCall.take).toBe(10);
      expect(findManyCall.skip).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // getStatus(assetId)
  // -------------------------------------------------------------------------

  describe("getStatus()", () => {
    it("returns status with correct daily usage percentage", async () => {
      const mockConfig = {
        assetId: "0xabcd",
        dailyLimit: "1000000",
        dailyUsed: "750000",
        circuitBreakerTripped: false,
        active: true,
      };

      mockPrisma.stablecoinConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await service.getStatus("0xabcd");

      expect(result).not.toBeNull();
      expect(result!.dailyUsagePercent).toBe(75);
      expect(result!.circuitBreakerTripped).toBe(false);
      expect(result!.active).toBe(true);
    });

    it("returns 0% usage when daily limit is 0", async () => {
      const mockConfig = {
        assetId: "0xabcd",
        dailyLimit: "0",
        dailyUsed: "0",
        circuitBreakerTripped: false,
        active: true,
      };

      mockPrisma.stablecoinConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await service.getStatus("0xabcd");

      expect(result!.dailyUsagePercent).toBe(0);
    });

    it("returns null when config not found", async () => {
      mockPrisma.stablecoinConfig.findUnique.mockResolvedValue(null);

      const result = await service.getStatus("0xnonexistent");

      expect(result).toBeNull();
    });

    it("handles values exceeding Number.MAX_SAFE_INTEGER without precision loss", async () => {
      // These values exceed 2^53 — parseFloat would lose precision,
      // but bigint arithmetic should handle them correctly.
      const mockConfig = {
        assetId: "0xabcd",
        dailyLimit: "10000000000000000000", // 10e18 (10 ETH-scale)
        dailyUsed: "2000000000000000000", // 2e18  → 20%
        circuitBreakerTripped: false,
        active: true,
      };

      mockPrisma.stablecoinConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await service.getStatus("0xabcd");

      expect(result).not.toBeNull();
      expect(result!.dailyUsagePercent).toBe(20);
    });

    it("handles fractional percentage with 2-decimal precision", async () => {
      const mockConfig = {
        assetId: "0xabcd",
        dailyLimit: "3000000",
        dailyUsed: "1000000", // 33.33%
        circuitBreakerTripped: false,
        active: true,
      };

      mockPrisma.stablecoinConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await service.getStatus("0xabcd");

      expect(result).not.toBeNull();
      expect(result!.dailyUsagePercent).toBe(33.33);
    });
  });
});
