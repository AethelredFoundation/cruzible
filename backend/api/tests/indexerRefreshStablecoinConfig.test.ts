import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStablecoinUpdate = vi.fn();
const mockStablecoinUpsert = vi.fn();
const mockFindUnique = vi.fn();
const mockVaultStateUpsert = vi.fn();
const mockShareHolderCount = vi.fn();
const TEST_ANCHOR_HASH = "0x" + "ab".repeat(32);
const mockWebSocketProviderInstance = {
  getNetwork: vi.fn(),
  getBlock: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
  destroy: vi.fn(),
};
const mockWebSocketProviderFactory = vi.fn(() => mockWebSocketProviderInstance);

function createWebSocketProviderMock(
  chainId = 31337n,
  hash = TEST_ANCHOR_HASH,
  blockNumber = 1,
) {
  const transportHandlers = new Map<string, (...args: any[]) => void>();
  return {
    _websocket: {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        transportHandlers.set(event, handler);
      }),
    },
    transportHandlers,
    getNetwork: vi.fn().mockResolvedValue({ chainId }),
    getBlock: vi.fn().mockResolvedValue({ hash, number: blockNumber }),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

const mockContractInstance = {
  stablecoins: vi.fn(),
  epochUsage: vi.fn(),
  totalPooledAethel: vi.fn(),
  totalShares: vi.fn(),
  getExchangeRate: vi.fn(),
  currentEpoch: vi.fn(),
  unbondingPeriod: vi.fn(),
  effectiveAPY: vi.fn(),
};

vi.mock("@prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function () {
    return {
      stablecoinConfig: {
        update: mockStablecoinUpdate,
        upsert: mockStablecoinUpsert,
        findUnique: mockFindUnique,
      },
      vaultState: { upsert: mockVaultStateUpsert },
      stAethelBalance: { count: mockShareHolderCount },
    };
  });
  return { PrismaClient: MockPrismaClient };
});

vi.mock("../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");

  return {
    ...actual,
    Contract: vi.fn().mockImplementation(function () {
      return mockContractInstance;
    }),
    WebSocketProvider: vi.fn().mockImplementation(function () {
      return mockWebSocketProviderFactory();
    }),
  };
});

describe("IndexerService.refreshStablecoinConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("materializes stablecoin config from the real bridge getter tuple shape", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");

    const service = new IndexerService({} as any);
    (service as any).cfg.stablecoinBridgeAddress =
      "0x1234567890123456789012345678901234567890";
    (service as any).httpProvider = {};

    mockContractInstance.stablecoins.mockResolvedValue([
      true, // enabled
      false, // mintPaused
      1, // routingType (CCTP_V2)
      "0xAABBCCDDEEFF0011223344556677889900AABBCC", // token
      "0x1111111111111111111111111111111111111111", // tokenMessengerV2
      "0x2222222222222222222222222222222222222222", // messageTransmitterV2
      "0x3333333333333333333333333333333333333333", // proofOfReserveFeed
      1_000_000_000n, // mintCeilingPerEpoch
      500_000_000n, // dailyTxLimit
      500, // hourlyOutflowBps
      1000, // dailyOutflowBps
      200, // porDeviationBps
      3600, // porHeartbeatSeconds
    ]);

    mockContractInstance.epochUsage.mockResolvedValue([
      42n, // epochId
      100_000_000n, // mintedAmount
      250_000_000n, // txVolume
    ]);

    mockStablecoinUpdate.mockResolvedValue(undefined);

    await (service as any).refreshStablecoinConfig(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      777,
    );

    expect(mockContractInstance.stablecoins).toHaveBeenCalledWith(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      { blockTag: 777 },
    );
    expect(mockContractInstance.epochUsage).toHaveBeenCalledWith(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      { blockTag: 777 },
    );
    expect(mockStablecoinUpdate).toHaveBeenCalledWith({
      where: {
        assetId:
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      },
      data: {
        tokenAddress: "0xaabbccddeeff0011223344556677889900aabbcc",
        routingType: 1,
        active: true,
        maxBridgeAmount: "1000000000",
        dailyLimit: "500000000",
        dailyUsed: "250000000",
        circuitBreakerTripped: false,
        blockNumber: 777n,
      },
    });
  });

  it("materializes mintPaused as the current circuit-breaker state", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).cfg.stablecoinBridgeAddress =
      "0x1234567890123456789012345678901234567890";
    (service as any).httpProvider = {};

    mockContractInstance.stablecoins.mockResolvedValue([
      true,
      true,
      1,
      "0xAABBCCDDEEFF0011223344556677889900AABBCC",
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
      1_000_000_000n,
      500_000_000n,
      500,
      1000,
      200,
      3600,
    ]);
    mockContractInstance.epochUsage.mockResolvedValue([42n, 0n, 10n]);
    mockStablecoinUpdate.mockResolvedValue(undefined);

    await (service as any).refreshStablecoinConfig(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      778,
    );

    expect(mockStablecoinUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ circuitBreakerTripped: true }),
      }),
    );
  });

  it("propagates an authoritative bridge read failure for block retry", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).cfg.stablecoinBridgeAddress =
      "0x1234567890123456789012345678901234567890";
    (service as any).httpProvider = {};
    mockContractInstance.stablecoins.mockRejectedValueOnce(
      new Error("bridge RPC unavailable"),
    );
    mockContractInstance.epochUsage.mockResolvedValueOnce([42n, 0n, 10n]);

    await expect(
      (service as any).refreshStablecoinConfig(
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        779,
      ),
    ).rejects.toThrow("bridge RPC unavailable");
  });
});

describe("IndexerService chain id guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows startup when the RPC chain id matches the configured chain", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");

    const service = new IndexerService({} as any);
    (service as any).cfg.expectedChainId = "31337";
    (service as any).cfg.expectedGenesisHash = TEST_ANCHOR_HASH;
    (service as any).httpProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }),
      getBlock: vi
        .fn()
        .mockResolvedValue({ hash: TEST_ANCHOR_HASH, number: 1 }),
    };

    await expect(
      (service as any).assertExpectedChainId(),
    ).resolves.toBeUndefined();
    expect((service as any).verifiedHttpChainId).toBe("31337");
    expect((service as any).verifiedHttpAnchorHash).toBe(TEST_ANCHOR_HASH);
  });

  it("fails closed before indexing when the RPC chain id is unexpected", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");

    const service = new IndexerService({} as any);
    (service as any).cfg.expectedChainId = "31337";
    (service as any).httpProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
      getBlock: vi
        .fn()
        .mockResolvedValue({ hash: TEST_ANCHOR_HASH, number: 1 }),
    };

    await expect((service as any).assertExpectedChainId()).rejects.toThrow(
      "Refusing to start indexer on chain 1; expected 31337",
    );
  });

  it("fails closed on the wrong network anchor even when chain id matches", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");

    const service = new IndexerService({} as any);
    (service as any).cfg.expectedChainId = "31337";
    (service as any).cfg.expectedGenesisHash = TEST_ANCHOR_HASH;
    (service as any).httpProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }),
      getBlock: vi
        .fn()
        .mockResolvedValue({ hash: "0x" + "cd".repeat(32), number: 1 }),
    };

    await expect((service as any).assertExpectedChainId()).rejects.toThrow(
      "Refusing to start indexer on network anchor",
    );
    expect((service as any).verifiedHttpChainId).toBeNull();
    expect((service as any).verifiedHttpAnchorHash).toBeNull();
  });

  it("fails closed when the HTTP anchor response is not exactly block 1", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).cfg.expectedChainId = "31337";
    (service as any).cfg.expectedGenesisHash = TEST_ANCHOR_HASH;
    (service as any).httpProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }),
      getBlock: vi.fn().mockResolvedValue({
        hash: TEST_ANCHOR_HASH,
        number: 2,
      }),
    };

    await expect((service as any).assertExpectedChainId()).rejects.toThrow(
      "exact canonical block 1 response",
    );
    expect((service as any).verifiedHttpChainId).toBeNull();
  });

  it("rejects a WebSocket provider on a different chain and retains HTTP", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");

    const service = new IndexerService({} as any);
    const httpProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }),
      getBlock: vi
        .fn()
        .mockResolvedValue({ hash: TEST_ANCHOR_HASH, number: 1 }),
    };
    (service as any).cfg.expectedChainId = "31337";
    (service as any).cfg.expectedGenesisHash = TEST_ANCHOR_HASH;
    (service as any).cfg.wsUrl = "ws://wrong-chain.invalid";
    (service as any).httpProvider = httpProvider;
    (service as any).running = true;
    mockWebSocketProviderInstance.getNetwork.mockResolvedValueOnce({
      chainId: 1n,
    });
    mockWebSocketProviderInstance.getBlock.mockResolvedValueOnce({
      hash: TEST_ANCHOR_HASH,
      number: 1,
    });
    mockWebSocketProviderInstance.destroy.mockResolvedValueOnce(undefined);

    await (service as any).assertExpectedChainId();
    await (service as any).connectWebSocket();

    expect((service as any).wsChainRejected).toBe(true);
    expect((service as any).wsProvider).toBeNull();
    expect((service as any).getProvider()).toBe(httpProvider);
    expect(service.getMetrics()).toMatchObject({ wsConnected: false });
    expect(mockWebSocketProviderInstance.on).not.toHaveBeenCalledWith(
      "block",
      expect.any(Function),
    );
    expect(mockWebSocketProviderInstance.destroy).toHaveBeenCalledOnce();

    (service as any).running = false;
    clearTimeout((service as any).pollTimer);
    (service as any).pollTimer = null;
  });

  it("rejects a same-chain WebSocket provider with the wrong anchor", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");

    const wrongAnchorProvider = createWebSocketProviderMock(
      31337n,
      "0x" + "cd".repeat(32),
    );
    mockWebSocketProviderFactory.mockImplementationOnce(
      () => wrongAnchorProvider as any,
    );
    const service = new IndexerService({} as any);
    const httpProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }),
      getBlock: vi
        .fn()
        .mockResolvedValue({ hash: TEST_ANCHOR_HASH, number: 1 }),
    };
    (service as any).cfg.expectedChainId = "31337";
    (service as any).cfg.expectedGenesisHash = TEST_ANCHOR_HASH;
    (service as any).cfg.wsUrl = "ws://wrong-anchor.invalid";
    (service as any).httpProvider = httpProvider;
    (service as any).running = true;

    await (service as any).assertExpectedChainId();
    await (service as any).connectWebSocket();

    expect((service as any).wsChainRejected).toBe(true);
    expect((service as any).wsProvider).toBeNull();
    expect((service as any).getProvider()).toBe(httpProvider);
    expect(wrongAnchorProvider.on).not.toHaveBeenCalledWith(
      "block",
      expect.any(Function),
    );
    expect(wrongAnchorProvider.destroy).toHaveBeenCalledOnce();

    (service as any).running = false;
    clearTimeout((service as any).pollTimer);
    (service as any).pollTimer = null;
  });

  it("rejects a WebSocket anchor response whose returned height is not block 1", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const wrongHeightProvider = createWebSocketProviderMock(
      31337n,
      TEST_ANCHOR_HASH,
      2,
    );
    mockWebSocketProviderFactory.mockImplementationOnce(
      () => wrongHeightProvider as any,
    );
    const service = new IndexerService({} as any);
    const httpProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }),
      getBlock: vi
        .fn()
        .mockResolvedValue({ hash: TEST_ANCHOR_HASH, number: 1 }),
    };
    (service as any).cfg.expectedChainId = "31337";
    (service as any).cfg.expectedGenesisHash = TEST_ANCHOR_HASH;
    (service as any).cfg.wsUrl = "ws://wrong-height.invalid";
    (service as any).httpProvider = httpProvider;
    (service as any).running = true;

    await (service as any).assertExpectedChainId();
    await (service as any).connectWebSocket();

    expect((service as any).wsProvider).toBeNull();
    expect((service as any).getProvider()).toBe(httpProvider);
    expect(wrongHeightProvider.on).not.toHaveBeenCalledWith(
      "block",
      expect.any(Function),
    );
    expect(wrongHeightProvider.destroy).toHaveBeenCalledOnce();

    (service as any).running = false;
    clearTimeout((service as any).pollTimer);
    (service as any).pollTimer = null;
  });

  it("coalesces error and close into one tracked reconnect and subscription", async () => {
    vi.useFakeTimers();
    try {
      const { IndexerService } = await import("../src/services/IndexerService");
      const firstProvider = createWebSocketProviderMock();
      const secondProvider = createWebSocketProviderMock();
      mockWebSocketProviderFactory
        .mockImplementationOnce(() => firstProvider as any)
        .mockImplementationOnce(() => secondProvider as any);

      const service = new IndexerService({} as any);
      (service as any).cfg.expectedChainId = "31337";
      (service as any).cfg.expectedGenesisHash = TEST_ANCHOR_HASH;
      (service as any).cfg.wsUrl = "ws://reconnect.invalid";
      (service as any).httpProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }),
        getBlock: vi
          .fn()
          .mockResolvedValue({ hash: TEST_ANCHOR_HASH, number: 1 }),
      };
      (service as any).running = true;
      vi.spyOn(service as any, "schedulePollTick").mockImplementation(() => {});

      await (service as any).assertExpectedChainId();
      await Promise.all([
        (service as any).connectWebSocket(),
        (service as any).connectWebSocket(),
      ]);
      expect(mockWebSocketProviderFactory).toHaveBeenCalledTimes(1);
      expect(
        firstProvider.on.mock.calls.filter(([event]) => event === "block"),
      ).toHaveLength(1);

      firstProvider.transportHandlers.get("error")?.(new Error("socket lost"));
      firstProvider.transportHandlers.get("close")?.();

      expect((service as any).wsReconnectAttempts).toBe(1);
      expect((service as any).wsReconnectTimer).not.toBeNull();
      await vi.advanceTimersByTimeAsync(3_000);
      if ((service as any).wsConnectPromise) {
        await (service as any).wsConnectPromise;
      }

      expect(mockWebSocketProviderFactory).toHaveBeenCalledTimes(2);
      expect(
        secondProvider.on.mock.calls.filter(([event]) => event === "block"),
      ).toHaveLength(1);
      expect(firstProvider.destroy).toHaveBeenCalledOnce();
      expect((service as any).wsProvider).toBe(secondProvider);
      expect(service.getMetrics()).toMatchObject({ wsConnected: true });

      (service as any).running = false;
      clearTimeout((service as any).wsReconnectTimer);
      (service as any).wsReconnectTimer = null;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("IndexerService.refreshVaultState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("materializes the contract-computed effective APY in percentage units", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).cfg.cruzibleVaultAddress =
      "0x1234567890123456789012345678901234567890";
    (service as any).httpProvider = {};

    mockContractInstance.totalPooledAethel.mockResolvedValue(1_050n);
    mockContractInstance.totalShares.mockResolvedValue(1_000n);
    mockContractInstance.getExchangeRate.mockResolvedValue(
      1_050_000_000_000_000_000n,
    );
    mockContractInstance.currentEpoch.mockResolvedValue(42n);
    mockContractInstance.unbondingPeriod.mockResolvedValue(604_800n);
    mockContractInstance.effectiveAPY.mockResolvedValue(1_234n);
    mockShareHolderCount.mockResolvedValue(7);
    mockVaultStateUpsert.mockResolvedValue(undefined);

    await (service as any).refreshVaultState(99);

    for (const viewMethod of [
      mockContractInstance.totalPooledAethel,
      mockContractInstance.totalShares,
      mockContractInstance.getExchangeRate,
      mockContractInstance.currentEpoch,
      mockContractInstance.unbondingPeriod,
      mockContractInstance.effectiveAPY,
    ]) {
      expect(viewMethod).toHaveBeenCalledWith({ blockTag: 99 });
    }
    expect(mockShareHolderCount).toHaveBeenCalledWith({
      where: { NOT: { shares: "0" } },
    });
    expect(mockVaultStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          blockNumber: 99n,
          currentApy: 12.34,
        }),
        create: expect.objectContaining({
          blockNumber: 99n,
          currentApy: 12.34,
        }),
      }),
    );
  });
});
