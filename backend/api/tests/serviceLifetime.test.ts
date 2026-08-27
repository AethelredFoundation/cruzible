import "reflect-metadata";
import { container } from "tsyringe";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(function () {
    return {
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("../src/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("service lifetimes", () => {
  afterEach(() => {
    container.clearInstances();
    (container as unknown as { reset?: () => void }).reset?.();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("shares startup and route service instances through the container", async () => {
    const { AlertService } = await import("../src/services/AlertService");
    const { BlockchainService } =
      await import("../src/services/BlockchainService");
    const { CacheService } = await import("../src/services/CacheService");
    const { IndexerService } = await import("../src/services/IndexerService");
    const { JobsService } = await import("../src/services/JobsService");
    const { ModelsService } = await import("../src/services/ModelsService");
    const { ReconciliationScheduler } =
      await import("../src/services/ReconciliationScheduler");
    const { ReconciliationService } =
      await import("../src/services/ReconciliationService");
    const { SealsService } = await import("../src/services/SealsService");
    const { StablecoinBridgeService } =
      await import("../src/services/StablecoinBridgeService");

    const serviceTokens = [
      AlertService,
      BlockchainService,
      CacheService,
      IndexerService,
      JobsService,
      ModelsService,
      ReconciliationScheduler,
      ReconciliationService,
      SealsService,
      StablecoinBridgeService,
    ];

    for (const token of serviceTokens) {
      expect(container.resolve(token)).toBe(container.resolve(token));
    }
  });
});
