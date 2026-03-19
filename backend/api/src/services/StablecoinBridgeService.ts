/**
 * StablecoinBridgeService
 *
 * Reads stablecoin configuration and bridge event data from the database.
 * Provides a clean interface for the stablecoins API routes.
 *
 * This service is read-only — all writes happen via the IndexerService
 * which processes on-chain events and persists them to the database.
 */

import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StablecoinConfigDTO {
  assetId: string;
  symbol: string;
  tokenAddress: string;
  routingType: number;
  cctpDomain: number | null;
  maxBridgeAmount: string;
  dailyLimit: string;
  dailyUsed: string;
  circuitBreakerTripped: boolean;
  active: boolean;
  lastResetTimestamp: string | null;
  blockNumber: string;
}

export interface StablecoinBridgeEventDTO {
  id: string;
  assetId: string;
  eventType: string;
  sender: string;
  amount: string;
  destDomain: number | null;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  timestamp: string;
  metadata: Record<string, unknown> | null;
}

export interface StablecoinStatusDTO {
  assetId: string;
  circuitBreakerTripped: boolean;
  dailyLimit: string;
  dailyUsed: string;
  dailyUsagePercent: number;
  active: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@injectable()
export class StablecoinBridgeService {
  constructor(@inject(PrismaClient) private readonly prisma: PrismaClient) {}

  // -----------------------------------------------------------------------
  // Configs
  // -----------------------------------------------------------------------

  /**
   * List all stablecoin configurations.
   */
  async getConfigs(): Promise<StablecoinConfigDTO[]> {
    try {
      const configs = await this.prisma.stablecoinConfig.findMany({
        orderBy: { symbol: "asc" },
      });

      return configs.map((c) => ({
        assetId: c.assetId,
        symbol: c.symbol,
        tokenAddress: c.tokenAddress,
        routingType: c.routingType,
        cctpDomain: c.cctpDomain,
        maxBridgeAmount: c.maxBridgeAmount,
        dailyLimit: c.dailyLimit,
        dailyUsed: c.dailyUsed,
        circuitBreakerTripped: c.circuitBreakerTripped,
        active: c.active,
        lastResetTimestamp: c.lastResetTimestamp?.toISOString() ?? null,
        blockNumber: c.blockNumber.toString(),
      }));
    } catch (error) {
      logger.error("Failed to fetch stablecoin configs", { error });
      throw error;
    }
  }

  /**
   * Get a single stablecoin configuration by assetId.
   */
  async getConfig(assetId: string): Promise<StablecoinConfigDTO | null> {
    try {
      const config = await this.prisma.stablecoinConfig.findUnique({
        where: { assetId },
      });

      if (!config) return null;

      return {
        assetId: config.assetId,
        symbol: config.symbol,
        tokenAddress: config.tokenAddress,
        routingType: config.routingType,
        cctpDomain: config.cctpDomain,
        maxBridgeAmount: config.maxBridgeAmount,
        dailyLimit: config.dailyLimit,
        dailyUsed: config.dailyUsed,
        circuitBreakerTripped: config.circuitBreakerTripped,
        active: config.active,
        lastResetTimestamp: config.lastResetTimestamp?.toISOString() ?? null,
        blockNumber: config.blockNumber.toString(),
      };
    } catch (error) {
      logger.error("Failed to fetch stablecoin config", { assetId, error });
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Bridge Events / History
  // -----------------------------------------------------------------------

  /**
   * Get paginated bridge events for a given assetId.
   */
  async getBridgeHistory(
    assetId: string,
    options: { limit: number; offset: number; eventType?: string },
  ): Promise<PaginatedResult<StablecoinBridgeEventDTO>> {
    const { limit, offset, eventType } = options;

    try {
      const where: Record<string, unknown> = { assetId };
      if (eventType) {
        where.eventType = eventType;
      }

      const [events, total] = await Promise.all([
        this.prisma.stablecoinBridgeEvent.findMany({
          where,
          orderBy: { timestamp: "desc" },
          take: limit,
          skip: offset,
        }),
        this.prisma.stablecoinBridgeEvent.count({ where }),
      ]);

      return {
        data: events.map((e) => ({
          id: e.id,
          assetId: e.assetId,
          eventType: e.eventType,
          sender: e.sender,
          amount: e.amount,
          destDomain: e.destDomain,
          txHash: e.txHash,
          blockNumber: e.blockNumber.toString(),
          logIndex: e.logIndex,
          timestamp: e.timestamp.toISOString(),
          metadata: e.metadata as Record<string, unknown> | null,
        })),
        pagination: { total, limit, offset },
      };
    } catch (error) {
      logger.error("Failed to fetch bridge history", { assetId, error });
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  /**
   * Get the current circuit breaker and daily usage status for an asset.
   */
  async getStatus(assetId: string): Promise<StablecoinStatusDTO | null> {
    try {
      const config = await this.prisma.stablecoinConfig.findUnique({
        where: { assetId },
      });

      if (!config) return null;

      // Use bigint arithmetic to avoid precision loss — dailyLimit/dailyUsed
      // are stringified uint256 values that can exceed Number.MAX_SAFE_INTEGER.
      // Multiply by 10000 first, then divide, to get 2-decimal-place precision
      // without intermediate floating-point rounding.
      const limit = BigInt(config.dailyLimit || "0");
      const used = BigInt(config.dailyUsed || "0");
      const dailyUsagePercent =
        limit > 0n
          ? Number((used * 10000n) / limit) / 100 // e.g. 2000 / 100 = 20.00%
          : 0;

      return {
        assetId: config.assetId,
        circuitBreakerTripped: config.circuitBreakerTripped,
        dailyLimit: config.dailyLimit,
        dailyUsed: config.dailyUsed,
        dailyUsagePercent: Math.round(dailyUsagePercent * 100) / 100,
        active: config.active,
      };
    } catch (error) {
      logger.error("Failed to fetch stablecoin status", { assetId, error });
      throw error;
    }
  }
}
