import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest before any imports
// ---------------------------------------------------------------------------

const prismaMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  indexerCursorFindUnique: vi.fn(),
  vaultStateFindFirst: vi.fn(),
  stablecoinConfigFindMany: vi.fn(),
  stablecoinConfigUpdate: vi.fn(),
}));

// Mock PrismaClient so the scheduler constructor and fetchIndexedState work.
vi.mock("@prisma/client", () => {
  // Must use function keyword (not arrow) for Vitest 4.x constructor mocks.
  const MockPrismaClient = vi.fn().mockImplementation(function () {
    return {
      $transaction: prismaMocks.transaction,
      $disconnect: vi.fn().mockResolvedValue(undefined),
      indexerCursor: {
        findUnique: prismaMocks.indexerCursorFindUnique,
      },
      vaultState: {
        findFirst: prismaMocks.vaultStateFindFirst,
      },
      stablecoinConfig: {
        findMany: prismaMocks.stablecoinConfigFindMany,
        update: prismaMocks.stablecoinConfigUpdate,
      },
    };
  });
  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      TransactionIsolationLevel: {
        RepeatableRead: "RepeatableRead",
      },
    },
  };
});

// Mock logger — we need a reference to assert on specific messages.
vi.mock("../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Static import after mocks are hoisted — gets the mocked versions.
import { ReconciliationScheduler } from "../src/services/ReconciliationScheduler";
import { logger } from "../src/utils/logger";
import { config } from "../src/config";
import { getConfiguredIndexerNetworkKeys } from "../src/lib/indexerNetworkIdentity";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReconciliationScheduler lifecycle and overlap guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    prismaMocks.transaction.mockImplementation(async (operation) =>
      operation({
        indexerCursor: {
          findUnique: prismaMocks.indexerCursorFindUnique,
        },
        vaultState: {
          findFirst: prismaMocks.vaultStateFindFirst,
        },
        stablecoinConfig: {
          findMany: prismaMocks.stablecoinConfigFindMany,
        },
      }),
    );
    const configuredNetwork = getConfiguredIndexerNetworkKeys();
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 100n,
      pendingBlockNumber: null,
      requiresRebuild: false,
      networkChainId: configuredNetwork?.identity.chainId ?? null,
      networkAnchorHash: configuredNetwork?.identity.anchorHash ?? null,
      networkVaultAddress: configuredNetwork?.identity.vaultAddress ?? null,
      networkStaethelAddress:
        configuredNetwork?.identity.staethelAddress ?? null,
      networkStablecoinBridgeAddress:
        configuredNetwork?.identity.stablecoinBridgeAddress ?? null,
    });
    prismaMocks.vaultStateFindFirst.mockResolvedValue(null);
    prismaMocks.stablecoinConfigFindMany.mockResolvedValue([]);
    prismaMocks.stablecoinConfigUpdate.mockResolvedValue(null);
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Helper — build a scheduler with fully mocked dependencies
  // -----------------------------------------------------------------------

  function createScheduler(overrides?: {
    getLatestHeight?: (...args: unknown[]) => Promise<number>;
    getValidators?: (...args: unknown[]) => Promise<unknown>;
    cacheService?: Record<string, unknown>;
  }) {
    const blockchainService = {
      getLatestHeight:
        overrides?.getLatestHeight ?? vi.fn().mockResolvedValue(100),
      getValidators:
        overrides?.getValidators ??
        vi.fn().mockResolvedValue({
          data: [
            { tokens: "1000", jailed: false },
            { tokens: "2000", jailed: false },
            { tokens: "3000", jailed: false },
            { tokens: "4000", jailed: false },
            { tokens: "5000", jailed: false },
          ],
        }),
    };

    const cacheService =
      overrides?.cacheService ??
      ({
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        tryAcquireLease: vi.fn().mockResolvedValue(true),
        renewLease: vi.fn().mockResolvedValue(true),
        releaseLease: vi.fn().mockResolvedValue(true),
        isLeaseOwner: vi.fn().mockResolvedValue(true),
        publishWhileLeaseOwner: vi.fn().mockResolvedValue(true),
        claimLeaseAction: vi.fn().mockResolvedValue(true),
      } as const);

    const alertService = {
      sendAlert: vi.fn().mockResolvedValue(null),
      sendDurableAlert: vi.fn().mockResolvedValue(null),
      retryUndeliveredAlerts: vi.fn().mockResolvedValue({
        attempted: 0,
        delivered: 0,
        deadLettered: 0,
      }),
      getActiveCriticalCount: vi.fn().mockReturnValue(0),
    };

    const scheduler = new ReconciliationScheduler(
      blockchainService as any,
      cacheService as any,
      alertService as any,
    );

    return { scheduler, blockchainService, cacheService, alertService };
  }

  it("reads cursor, vault, and stablecoin projections from one committed repeatable-read snapshot", async () => {
    const { scheduler } = createScheduler();
    let transactionOpen = false;
    prismaMocks.transaction.mockImplementationOnce(async (operation) => {
      transactionOpen = true;
      try {
        return await operation({
          indexerCursor: {
            findUnique: prismaMocks.indexerCursorFindUnique,
          },
          vaultState: {
            findFirst: prismaMocks.vaultStateFindFirst,
          },
          stablecoinConfig: {
            findMany: prismaMocks.stablecoinConfigFindMany,
          },
        });
      } finally {
        transactionOpen = false;
      }
    });
    prismaMocks.vaultStateFindFirst.mockResolvedValue({
      blockNumber: 99n,
      totalStaked: "1000",
      totalShares: "900",
      exchangeRate: "1.111111111111111111",
      currentEpoch: 7n,
      validatorsBacking: 4,
      totalStakers: 3,
      updatedAt: new Date("2026-07-18T00:00:00.000Z"),
    });
    prismaMocks.stablecoinConfigFindMany.mockResolvedValue([
      {
        id: "stablecoin-1",
        assetId: keccak256(toUtf8Bytes("USDC")),
        symbol: "",
        circuitBreakerTripped: false,
        dailyLimit: "1000",
        dailyUsed: "100",
        blockNumber: 99n,
      },
    ]);
    prismaMocks.stablecoinConfigUpdate.mockImplementation(async () => {
      expect(transactionOpen).toBe(false);
      return null;
    });

    const generation = await (scheduler as any).fetchIndexedState();
    await (scheduler as any).runStablecoinChecks(generation.stablecoinConfigs);

    expect(prismaMocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(prismaMocks.stablecoinConfigFindMany).toHaveBeenCalledOnce();
    expect(prismaMocks.stablecoinConfigUpdate).toHaveBeenCalledOnce();
    expect(generation).toMatchObject({
      state: {
        blockNumber: 99,
        totalStaked: "1000",
        totalShares: "900",
      },
      stablecoinConfigs: [
        expect.objectContaining({ symbol: "USDC", dailyUsed: "100" }),
      ],
    });
  });

  it.each([
    ["missing", null],
    [
      "pending",
      {
        blockNumber: 100n,
        pendingBlockNumber: 101n,
        requiresRebuild: false,
      },
    ],
    [
      "rebuilding",
      {
        blockNumber: 100n,
        pendingBlockNumber: null,
        requiresRebuild: true,
      },
    ],
  ])("fails closed for a %s indexer generation", async (_case, cursor) => {
    const { scheduler } = createScheduler();
    prismaMocks.indexerCursorFindUnique.mockResolvedValue(cursor);

    await expect((scheduler as any).fetchIndexedState()).rejects.toThrow(
      "Reconciliation refused an indexed snapshot",
    );
    expect(prismaMocks.vaultStateFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.stablecoinConfigFindMany).not.toHaveBeenCalled();
  });

  it("fails closed when the cursor source identity differs from configuration", async () => {
    const mutableConfig = config as unknown as {
      indexerExpectedChainId?: string;
      indexerExpectedGenesisHash?: string;
      cruzibleVaultAddress: string;
      staethelAddress: string;
      stablecoinBridgeAddress: string;
    };
    const original = { ...mutableConfig };
    Object.assign(mutableConfig, {
      indexerExpectedChainId: "7332",
      indexerExpectedGenesisHash: "0x" + "aa".repeat(32),
      cruzibleVaultAddress: "0x1111111111111111111111111111111111111111",
      staethelAddress: "0x2222222222222222222222222222222222222222",
      stablecoinBridgeAddress: "0x3333333333333333333333333333333333333333",
    });
    try {
      const { scheduler } = createScheduler();
      prismaMocks.indexerCursorFindUnique.mockResolvedValue({
        blockNumber: 100n,
        pendingBlockNumber: null,
        requiresRebuild: false,
        networkChainId: "7332",
        networkAnchorHash: "0x" + "aa".repeat(32),
        networkVaultAddress: "0x1111111111111111111111111111111111111111",
        networkStaethelAddress: "0x4444444444444444444444444444444444444444",
        networkStablecoinBridgeAddress:
          "0x3333333333333333333333333333333333333333",
      });

      await expect((scheduler as any).fetchIndexedState()).rejects.toThrow(
        "bound to another indexed source identity",
      );
    } finally {
      Object.assign(mutableConfig, original);
    }
  });

  it("fails closed when VaultState is ahead of the committed cursor", async () => {
    const { scheduler } = createScheduler();
    prismaMocks.vaultStateFindFirst.mockResolvedValue({
      blockNumber: 101n,
      totalStaked: "1000",
      totalShares: "1000",
      exchangeRate: "1.000000000000000000",
      currentEpoch: 1n,
      validatorsBacking: 4,
      totalStakers: 1,
      updatedAt: new Date(),
    });

    await expect((scheduler as any).fetchIndexedState()).rejects.toThrow(
      "ahead of the committed indexer cursor",
    );
  });

  it("fails closed when a stablecoin projection is ahead of the committed cursor", async () => {
    const { scheduler } = createScheduler();
    prismaMocks.stablecoinConfigFindMany.mockResolvedValue([
      {
        id: "stablecoin-ahead",
        assetId: keccak256(toUtf8Bytes("USDC")),
        symbol: "USDC",
        circuitBreakerTripped: false,
        dailyLimit: "1000",
        dailyUsed: "100",
        blockNumber: 101n,
      },
    ]);

    await expect((scheduler as any).fetchIndexedState()).rejects.toThrow(
      "stablecoin projection ahead of the committed indexer cursor",
    );
  });

  // -----------------------------------------------------------------------
  // Lifecycle tests
  // -----------------------------------------------------------------------

  it("start() fires an immediate tick and produces a result", async () => {
    const { scheduler } = createScheduler();

    expect(scheduler.getLatestResult()).toBeNull();

    scheduler.start();

    // Let the immediate tick's async work (microtasks) complete
    await vi.advanceTimersByTimeAsync(0);

    expect(scheduler.getLatestResult()).not.toBeNull();
    expect(scheduler.getLatestResult()!.status).toBeDefined();
    expect(scheduler.getLatestResult()!.epochSource).toBeDefined();

    scheduler.stop();
  });

  it("does not expose an OK result forever after it becomes stale", async () => {
    const { scheduler } = createScheduler();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.getLatestResult()).not.toBeNull();

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(600_001);

    expect(scheduler.getLatestResult()).toBeNull();
  });

  it("discards a completed tick if the leader lease was lost before publish", async () => {
    const cacheService = {
      get: vi.fn().mockResolvedValue(null),
      tryAcquireLease: vi.fn().mockResolvedValue(true),
      renewLease: vi.fn().mockResolvedValue(false),
      releaseLease: vi.fn().mockResolvedValue(false),
      isLeaseOwner: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false),
      publishWhileLeaseOwner: vi.fn().mockResolvedValue(false),
      claimLeaseAction: vi.fn().mockResolvedValue(false),
    };
    const { scheduler } = createScheduler({ cacheService });
    vi.spyOn(scheduler as any, "fetchIndexedState").mockResolvedValue({
      state: {
        blockNumber: 100,
        totalStaked: "0",
        totalShares: "0",
        exchangeRate: "1.000000000000000000",
        currentEpoch: 100,
        validatorsBacking: 5,
        totalStakers: 0,
        lastUpdated: new Date().toISOString(),
      },
      stablecoinConfigs: [],
    });
    vi.spyOn(scheduler as any, "fetchOnChainState").mockResolvedValue({
      latestHeight: 100,
      protocolEpoch: 100,
      epochSource: "consensus",
      validatorCount: 5,
      activeValidatorCount: 5,
      totalStaked: "0",
      vaultBlockNumber: 100,
      vaultTotalPooled: "0",
      vaultTotalShares: "0",
      vaultExchangeRate: "1.000000000000000000",
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(cacheService.publishWhileLeaseOwner).toHaveBeenCalledOnce();
    expect(scheduler.getLatestResult()).toBeNull();
    expect(scheduler.getLeadershipStatus()).toBe("follower");
    scheduler.stop();
  });

  it("records epoch source and warns when it falls back to chain height", async () => {
    const { scheduler } = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    const result = scheduler.getLatestResult();
    expect(result).not.toBeNull();
    expect(result!.epoch).toBe(100);
    expect(result!.epochSource).toBe("rpc/tendermint.latestHeight (fallback)");
    expect(result!.status).toBe("WARNING");
    expect(
      result!.checks.some(
        (check) =>
          check.name === "epoch_resolution" && check.status === "WARNING",
      ),
    ).toBe(true);

    scheduler.stop();
  });

  it("keeps raw tick failure details out of public reconciliation checks", async () => {
    const { scheduler } = createScheduler({
      getLatestHeight: vi
        .fn()
        .mockRejectedValue(
          new Error("dial tcp secret-rpc.internal:26657: connection refused"),
        ),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    const result = scheduler.getLatestResult();
    expect(result).not.toBeNull();
    expect(result!.status).toBe("CRITICAL");

    const tickCheck = result!.checks.find(
      (check) => check.name === "tick_execution",
    );
    expect(tickCheck).toMatchObject({
      status: "CRITICAL",
      message:
        "Reconciliation tick failed. Operator logs contain internal diagnostics.",
      metadata: { errorType: "Error" },
    });

    const publicPayload = JSON.stringify(result);
    expect(publicPayload).not.toContain("secret-rpc.internal");
    expect(publicPayload).not.toContain("26657");
    expect(publicPayload).not.toContain("connection refused");

    scheduler.stop();
  });

  it("fails required production vault checks closed when indexed/live truth is absent", () => {
    const mutableConfig = config as unknown as { isProduction: boolean };
    const originalProduction = mutableConfig.isProduction;
    mutableConfig.isProduction = true;

    try {
      const { scheduler } = createScheduler();
      const onChain = {
        protocolEpoch: 0,
        vaultExchangeRate: null,
        vaultTotalPooled: null,
      };
      const indexed = {
        exchangeRate: null,
        totalStaked: null,
        currentEpoch: null,
        lastUpdated: null,
      };

      expect(
        (scheduler as any).checkExchangeRate(onChain, indexed).status,
      ).toBe("CRITICAL");
      expect(
        (scheduler as any).checkTvlConsistency(onChain, indexed).status,
      ).toBe("CRITICAL");
      expect(
        (scheduler as any).checkEpochFreshness(onChain, indexed).status,
      ).toBe("CRITICAL");
    } finally {
      mutableConfig.isProduction = originalProduction;
    }
  });

  it("fails a required stablecoin profile closed when no config was indexed", async () => {
    const mutableConfig = config as unknown as {
      indexerRequireStablecoinBridge: boolean;
    };
    const originalRequired = mutableConfig.indexerRequireStablecoinBridge;
    mutableConfig.indexerRequireStablecoinBridge = true;

    try {
      const { scheduler } = createScheduler();
      await expect((scheduler as any).runStablecoinChecks([])).resolves.toEqual(
        [
          expect.objectContaining({
            name: "stablecoin_bridge",
            status: "CRITICAL",
          }),
        ],
      );
    } finally {
      mutableConfig.indexerRequireStablecoinBridge = originalRequired;
    }
  });

  it("treats accrued rewards above a 1.05 exchange rate as healthy when live and indexed truth agree", () => {
    const { scheduler, alertService } = createScheduler();
    const check = (scheduler as any).checkExchangeRate(
      {
        vaultExchangeRate: "1.100000000000000000",
      },
      {
        exchangeRate: "1.100000000000000000",
      },
    );

    expect(check).toMatchObject({
      name: "exchange_rate",
      status: "PASS",
      metadata: {
        indexedExchangeRate: "1.100000000000000000",
        liveExchangeRate: "1.100000000000000000",
        drift: 0,
      },
    });
    expect(alertService.sendAlert).not.toHaveBeenCalled();
  });

  it("compares indexed TVL to the vault pool rather than network-wide validator stake", () => {
    const { scheduler, alertService } = createScheduler();
    const check = (scheduler as any).checkTvlConsistency(
      {
        totalStaked: "999999999999999999999999999999",
        vaultTotalPooled: "250000000000000000000",
      },
      {
        totalStaked: "250000000000000000000",
      },
    );

    expect(check).toMatchObject({
      name: "tvl_consistency",
      status: "PASS",
      metadata: {
        liveVaultTvl: "250000000000000000000",
        indexedTvl: "250000000000000000000",
        driftPct: 0,
      },
    });
    expect(alertService.sendAlert).not.toHaveBeenCalled();
  });

  it("fails reconciliation when indexed total shares differ at the same block", () => {
    const { scheduler } = createScheduler();
    (scheduler as any).activeAlertQueue = [];

    const check = (scheduler as any).checkTotalSharesConsistency(
      {
        vaultBlockNumber: 100,
        vaultTotalShares: "1000000000000000000",
      },
      { totalShares: "999999999999999999" },
    );

    expect(check).toMatchObject({
      name: "total_shares_consistency",
      status: "CRITICAL",
      metadata: {
        blockNumber: 100,
        indexedTotalShares: "999999999999999999",
        liveTotalShares: "1000000000000000000",
      },
    });
    expect((scheduler as any).activeAlertQueue).toEqual([
      expect.objectContaining({
        severity: "CRITICAL",
        type: "RECONCILIATION_MISMATCH",
      }),
    ]);
  });

  it("passes reconciliation when indexed and live total shares match", () => {
    const { scheduler } = createScheduler();
    const check = (scheduler as any).checkTotalSharesConsistency(
      {
        vaultBlockNumber: 100,
        vaultTotalShares: "0",
      },
      { totalShares: "0" },
    );

    expect(check).toMatchObject({
      name: "total_shares_consistency",
      status: "PASS",
    });
  });

  it("reports a matching but decreasing live exchange rate as possible slashing", async () => {
    const { scheduler, alertService } = createScheduler();
    (scheduler as any).lastResult = {
      onChainState: { vaultExchangeRate: "1.100000000000000000" },
    };
    (scheduler as any).leaseHeld = true;
    (scheduler as any).activeAlertQueue = [];

    const check = (scheduler as any).checkExchangeRate(
      { vaultExchangeRate: "1.050000000000000000" },
      { exchangeRate: "1.050000000000000000" },
    );

    expect(check).toMatchObject({
      name: "exchange_rate",
      status: "WARNING",
    });
    expect(check.message).toContain("decreased");
    expect((scheduler as any).activeAlertQueue).toEqual([
      expect.objectContaining({
        severity: "WARNING",
        type: "EXCHANGE_RATE_DRIFT",
      }),
    ]);
    expect(alertService.sendAlert).not.toHaveBeenCalled();
  });

  it("delivers distinct same-type reconciliation conditions without dedupe collisions", async () => {
    const { scheduler, cacheService, alertService } = createScheduler();
    const result = {
      timestamp: "2026-07-18T00:00:00.000Z",
    };
    const alerts = [
      {
        conditionKey: "exchange-rate-unavailable",
        severity: "CRITICAL",
        type: "RECONCILIATION_MISMATCH",
        message: "Exchange rate unavailable",
        metadata: {},
      },
      {
        conditionKey: "total-shares-mismatch",
        severity: "CRITICAL",
        type: "RECONCILIATION_MISMATCH",
        message: "Total shares mismatch",
        metadata: {},
      },
    ];

    await (scheduler as any).deliverClaimedAlerts(result, alerts);

    expect(cacheService.claimLeaseAction).toHaveBeenCalledTimes(2);
    expect(alertService.sendDurableAlert).toHaveBeenCalledTimes(2);
    const keys = alertService.sendDurableAlert.mock.calls.map(
      (call) => call[0],
    );
    expect(keys[0]).toContain("exchange-rate-unavailable");
    expect(keys[1]).toContain("total-shares-mismatch");
  });

  it("deduplicates the same condition across a leader retry window", async () => {
    const cacheService = {
      get: vi.fn().mockResolvedValue(null),
      tryAcquireLease: vi.fn().mockResolvedValue(true),
      renewLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(true),
      isLeaseOwner: vi.fn().mockResolvedValue(true),
      publishWhileLeaseOwner: vi.fn().mockResolvedValue(true),
      claimLeaseAction: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const { scheduler, alertService } = createScheduler({ cacheService });
    const result = { timestamp: "2026-07-18T00:00:00.000Z" };
    const alerts = [
      {
        conditionKey: "tvl-unavailable",
        severity: "CRITICAL",
        type: "RECONCILIATION_MISMATCH",
        message: "TVL unavailable",
        metadata: {},
      },
    ];

    await (scheduler as any).deliverClaimedAlerts(result, alerts);
    await (scheduler as any).deliverClaimedAlerts(result, alerts);

    expect(alertService.sendDurableAlert).toHaveBeenCalledOnce();
  });

  it("compares live vault truth at the indexed finalized block instead of a changed latest head", async () => {
    const { scheduler } = createScheduler();
    vi.spyOn(scheduler as any, "fetchIndexedState").mockResolvedValue({
      state: {
        blockNumber: 100,
        totalStaked: "1000",
        totalShares: "1000",
        exchangeRate: "1.000000000000000000",
        currentEpoch: 100,
        validatorsBacking: 0,
        totalStakers: 1,
        lastUpdated: new Date().toISOString(),
      },
      stablecoinConfigs: [],
    });
    const liveVaultRead = vi
      .spyOn(scheduler as any, "fetchLiveVaultState")
      .mockImplementation(async (blockTag: number) => {
        // Head may already contain a pending 20% reward, but block 100 is the
        // finalized state represented by VaultState and remains at 1.0.
        expect(blockTag).toBe(100);
        return {
          blockNumber: 100,
          totalPooled: "1000",
          totalShares: "1000",
          exchangeRate: "1.000000000000000000",
        };
      });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(liveVaultRead).toHaveBeenCalledWith(100);
    expect(
      scheduler
        .getLatestResult()!
        .checks.find((check) => check.name === "exchange_rate"),
    ).toMatchObject({ status: "PASS" });
    expect(
      scheduler
        .getLatestResult()!
        .checks.find((check) => check.name === "tvl_consistency"),
    ).toMatchObject({ status: "PASS" });

    scheduler.stop();
  });

  it("start() is idempotent — second call is a no-op", async () => {
    const { scheduler } = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    // Second start should be a no-op with a warning
    scheduler.start();

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("already running"),
    );

    scheduler.stop();
  });

  it("elects one scheduler across replicas and fails over after release", async () => {
    let owner: string | null = null;
    const sharedCache = {
      get: vi.fn().mockResolvedValue(null),
      tryAcquireLease: vi
        .fn()
        .mockImplementation(async (_key: string, candidate: string) => {
          if (owner !== null) return false;
          owner = candidate;
          return true;
        }),
      renewLease: vi
        .fn()
        .mockImplementation(
          async (_key: string, candidate: string) => owner === candidate,
        ),
      releaseLease: vi
        .fn()
        .mockImplementation(async (_key: string, candidate: string) => {
          if (owner !== candidate) return false;
          owner = null;
          return true;
        }),
      isLeaseOwner: vi
        .fn()
        .mockImplementation(
          async (_key: string, candidate: string) => owner === candidate,
        ),
      publishWhileLeaseOwner: vi.fn().mockResolvedValue(true),
      claimLeaseAction: vi.fn().mockResolvedValue(true),
    };
    const first = createScheduler({ cacheService: sharedCache });
    const second = createScheduler({ cacheService: sharedCache });

    first.scheduler.start();
    second.scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(
      vi.mocked(first.blockchainService.getLatestHeight).mock.calls.length +
        vi.mocked(second.blockchainService.getLatestHeight).mock.calls.length,
    ).toBe(1);

    const leader =
      first.scheduler.getLeadershipStatus() === "leader" ? first : second;
    const follower = leader === first ? second : first;
    leader.scheduler.stop();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(follower.scheduler.getLeadershipStatus()).toBe("leader");
    expect(
      vi.mocked(follower.blockchainService.getLatestHeight).mock.calls.length,
    ).toBe(1);

    follower.scheduler.stop();
  });

  it("stop() prevents further ticks after the initial one", async () => {
    const { scheduler, blockchainService } = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0); // complete the immediate tick

    const callsAfterStart = vi.mocked(blockchainService.getLatestHeight).mock
      .calls.length;

    scheduler.stop();

    // Advance well past the default interval (5 min = 300 000 ms)
    await vi.advanceTimersByTimeAsync(600_000);

    const callsAfterStop = vi.mocked(blockchainService.getLatestHeight).mock
      .calls.length;

    // No new blockchain calls after stop()
    expect(callsAfterStop).toBe(callsAfterStart);
  });

  it("stop() before start() is a safe no-op", () => {
    const { scheduler } = createScheduler();

    // Should not throw
    scheduler.stop();

    expect(scheduler.getLatestResult()).toBeNull();
  });

  it("releases a lease acquired concurrently with shutdown", async () => {
    let resolveAcquire!: (acquired: boolean) => void;
    const acquire = new Promise<boolean>((resolve) => {
      resolveAcquire = resolve;
    });
    const cacheService = {
      get: vi.fn().mockResolvedValue(null),
      tryAcquireLease: vi.fn().mockReturnValue(acquire),
      renewLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(true),
      isLeaseOwner: vi.fn().mockResolvedValue(true),
      publishWhileLeaseOwner: vi.fn().mockResolvedValue(true),
      claimLeaseAction: vi.fn().mockResolvedValue(true),
    };
    const { scheduler } = createScheduler({ cacheService });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const shutdown = scheduler.shutdown();
    resolveAcquire(true);
    await vi.advanceTimersByTimeAsync(0);
    await shutdown;

    expect(cacheService.releaseLease).toHaveBeenCalledOnce();
    expect(scheduler.getLeadershipStatus()).toBe("stopped");
  });

  // -----------------------------------------------------------------------
  // Overlap guard
  // -----------------------------------------------------------------------

  it("tickInFlight guard skips overlapping ticks", async () => {
    // Create a deferred promise so the first tick hangs
    let resolveHeight!: (value: number) => void;
    const slowHeight = new Promise<number>((resolve) => {
      resolveHeight = resolve;
    });

    // First call returns the slow promise; later calls resolve instantly.
    let callCount = 0;
    const { scheduler } = createScheduler({
      getLatestHeight: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return slowHeight;
        return Promise.resolve(200);
      }),
    });

    scheduler.start();
    // First tick is now in-flight, blocked on slowHeight.

    // Advance past the default interval to trigger the next scheduled tick.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // The interval tick should have been skipped because the first is still
    // in-flight.
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("previous tick still in flight"),
    );

    // Now let the first tick complete.
    resolveHeight(100);
    await vi.advanceTimersByTimeAsync(0); // flush microtasks

    // The first tick should have finished and stored a result.
    expect(scheduler.getLatestResult()).not.toBeNull();

    scheduler.stop();
  });
});
