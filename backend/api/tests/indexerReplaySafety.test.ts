import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, type Log } from "ethers";

const prismaMocks = vi.hoisted(() => {
  const tx = {
    stAethelTransfer: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    stAethelBalance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };

  return {
    tx,
    transaction: vi.fn(),
    blockUpsert: vi.fn(),
    blockFindUnique: vi.fn(),
    transactionFindUnique: vi.fn(),
    eventUpsert: vi.fn(),
    eventFindMany: vi.fn(),
    vaultStakeUpsert: vi.fn(),
    vaultUnstakeUpsert: vi.fn(),
    stAethelTransferCreate: vi.fn(),
    stAethelBalanceDeleteMany: vi.fn(),
    stAethelBalanceCreate: vi.fn(),
    reorgEventCreate: vi.fn(),
    indexerCursorFindUnique: vi.fn(),
    indexerCursorFindFirst: vi.fn(),
    indexerCursorCreate: vi.fn(),
    indexerCursorUpdate: vi.fn(),
    syncStateUpsert: vi.fn(),
    deleteStAethelTransfers: vi.fn(),
    deleteStablecoinBridgeEvents: vi.fn(),
    deleteStablecoinConfigs: vi.fn(),
    deleteVaultState: vi.fn(),
    deleteVaultWithdrawals: vi.fn(),
    deleteVaultRewards: vi.fn(),
    deleteVaultUnstakes: vi.fn(),
    deleteVaultStakes: vi.fn(),
    deleteEvents: vi.fn(),
    deleteMessages: vi.fn(),
    deleteTransactions: vi.fn(),
    deleteBlocks: vi.fn(),
    disconnect: vi.fn(),
  };
});

vi.mock("@prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function () {
    return {
      $transaction: prismaMocks.transaction,
      $disconnect: prismaMocks.disconnect,
      block: {
        upsert: prismaMocks.blockUpsert,
        findUnique: prismaMocks.blockFindUnique,
        deleteMany: prismaMocks.deleteBlocks,
      },
      transaction: {
        findUnique: prismaMocks.transactionFindUnique,
        deleteMany: prismaMocks.deleteTransactions,
      },
      event: {
        upsert: prismaMocks.eventUpsert,
        findMany: prismaMocks.eventFindMany,
        deleteMany: prismaMocks.deleteEvents,
      },
      stAethelTransfer: {
        create: prismaMocks.stAethelTransferCreate,
        deleteMany: prismaMocks.deleteStAethelTransfers,
      },
      stAethelBalance: {
        create: prismaMocks.stAethelBalanceCreate,
        deleteMany: prismaMocks.stAethelBalanceDeleteMany,
      },
      stablecoinBridgeEvent: {
        deleteMany: prismaMocks.deleteStablecoinBridgeEvents,
      },
      stablecoinConfig: { deleteMany: prismaMocks.deleteStablecoinConfigs },
      vaultState: { deleteMany: prismaMocks.deleteVaultState },
      vaultWithdrawal: { deleteMany: prismaMocks.deleteVaultWithdrawals },
      vaultReward: { deleteMany: prismaMocks.deleteVaultRewards },
      vaultUnstake: {
        upsert: prismaMocks.vaultUnstakeUpsert,
        deleteMany: prismaMocks.deleteVaultUnstakes,
      },
      vaultStake: {
        upsert: prismaMocks.vaultStakeUpsert,
        deleteMany: prismaMocks.deleteVaultStakes,
      },
      message: { deleteMany: prismaMocks.deleteMessages },
      reorgEvent: { create: prismaMocks.reorgEventCreate },
      indexerCursor: {
        findUnique: prismaMocks.indexerCursorFindUnique,
        findFirst: prismaMocks.indexerCursorFindFirst,
        create: prismaMocks.indexerCursorCreate,
        update: prismaMocks.indexerCursorUpdate,
      },
      syncState: { upsert: prismaMocks.syncStateUpsert },
    };
  });

  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      TransactionIsolationLevel: { Serializable: "Serializable" },
    },
  };
});

vi.mock("../src/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeLog(overrides: Partial<Log> = {}): Log {
  return {
    address: "0x1111111111111111111111111111111111111111",
    blockHash: "0x" + "22".repeat(32),
    blockNumber: 100,
    data: "0x",
    index: 3,
    removed: false,
    topics: ["0x" + "33".repeat(32)],
    transactionHash: "0x" + "44".repeat(32),
    transactionIndex: 0,
    ...overrides,
  } as Log;
}

describe("IndexerService replay and cursor safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.transaction
      .mockReset()
      .mockImplementation(async (operation) => {
        if (Array.isArray(operation)) {
          return Promise.all(operation);
        }
        return operation(prismaMocks.tx);
      });
    prismaMocks.blockUpsert.mockResolvedValue(undefined);
    prismaMocks.blockFindUnique.mockResolvedValue(null);
    prismaMocks.transactionFindUnique.mockResolvedValue(null);
    prismaMocks.eventUpsert.mockResolvedValue(undefined);
    prismaMocks.eventFindMany.mockResolvedValue([]);
    prismaMocks.vaultStakeUpsert.mockResolvedValue(undefined);
    prismaMocks.vaultUnstakeUpsert.mockResolvedValue(undefined);
    prismaMocks.stAethelTransferCreate.mockResolvedValue(undefined);
    prismaMocks.stAethelBalanceDeleteMany.mockResolvedValue(undefined);
    prismaMocks.stAethelBalanceCreate.mockResolvedValue(undefined);
    prismaMocks.reorgEventCreate.mockResolvedValue(undefined);
    prismaMocks.indexerCursorFindUnique.mockReset().mockResolvedValue(null);
    prismaMocks.indexerCursorFindFirst.mockReset().mockResolvedValue(null);
    prismaMocks.indexerCursorCreate.mockResolvedValue(undefined);
    prismaMocks.indexerCursorUpdate.mockResolvedValue(undefined);
    prismaMocks.syncStateUpsert.mockResolvedValue(undefined);
    prismaMocks.tx.stAethelTransfer.create.mockResolvedValue(undefined);
    prismaMocks.tx.stAethelBalance.upsert.mockResolvedValue(undefined);
    (prismaMocks.tx as any).indexerCursor = {
      findUnique: prismaMocks.indexerCursorFindUnique,
      findFirst: prismaMocks.indexerCursorFindFirst,
      create: prismaMocks.indexerCursorCreate,
      update: prismaMocks.indexerCursorUpdate,
    };
  });

  it("does not advance the block cursor when contract event indexing fails", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).httpProvider = {
      getBlock: vi.fn().mockResolvedValue({
        timestamp: 1_700_000_000,
        hash: "0x" + "55".repeat(32),
        parentHash: "0x" + "66".repeat(32),
        miner: "0x7777777777777777777777777777777777777777",
        transactions: [],
        prefetchedTransactions: [],
        gasUsed: 0n,
        gasLimit: 30_000_000n,
        stateRoot: "0x" + "88".repeat(32),
      }),
    };

    vi.spyOn(service as any, "indexContractEvents").mockRejectedValue(
      new Error("event persistence failed"),
    );
    const updateCursor = vi
      .spyOn(service as any, "updateCursor")
      .mockResolvedValue(undefined);

    await expect((service as any).indexBlock(100)).rejects.toThrow(
      "event persistence failed",
    );
    expect(updateCursor).not.toHaveBeenCalled();
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledWith({
      where: { cursorKey: "evm-indexer" },
      data: { pendingBlockNumber: 100n },
    });
    expect((service as any).pendingBlockNumber).toBe(100);
  });

  it("propagates a per-log persistence error to the block retry boundary", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    prismaMocks.eventUpsert.mockRejectedValueOnce(
      new Error("generic event write failed"),
    );

    await expect(
      (service as any).processLog(makeLog(), new Date()),
    ).rejects.toThrow("generic event write failed");
  });

  it("upserts generic events by transaction hash and log index", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    const log = makeLog();

    await (service as any).persistEventLog(log, new Date(1_700_000_000_000));

    expect(prismaMocks.eventUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          transactionHash_logIndex: {
            transactionHash: log.transactionHash,
            logIndex: log.index,
          },
        },
        create: expect.objectContaining({
          transactionHash: log.transactionHash,
          logIndex: log.index,
        }),
      }),
    );
  });

  it("applies invariant share deltas only once when a log is replayed", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    const transferInterface = new Interface([
      "event TransferShares(address indexed from, address indexed to, uint256 sharesValue)",
    ]);
    const from = "0x1111111111111111111111111111111111111111";
    const to = "0x2222222222222222222222222222222222222222";
    const encoded = transferInterface.encodeEventLog(
      transferInterface.getEvent("TransferShares")!,
      [from, to, 10n],
    );
    const log = makeLog({
      address: "0x9999999999999999999999999999999999999999",
      topics: encoded.topics,
      data: encoded.data,
    });

    prismaMocks.tx.stAethelTransfer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "already-indexed" });
    prismaMocks.tx.stAethelBalance.findUnique
      .mockResolvedValueOnce({ shares: "100" })
      .mockResolvedValueOnce(null);

    await (service as any).handleTransferSharesEvent(log, new Date());
    await (service as any).handleTransferSharesEvent(log, new Date());

    expect(prismaMocks.tx.stAethelTransfer.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.tx.stAethelBalance.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMocks.tx.stAethelBalance.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { holder: from },
        update: expect.objectContaining({ shares: "90" }),
      }),
    );
    expect(prismaMocks.tx.stAethelBalance.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { holder: to },
        update: expect.objectContaining({ shares: "10" }),
      }),
    );
  });

  it("keeps share balances invariant across a reward rebase and later transfer", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    const shareInterface = new Interface([
      "event TransferShares(address indexed from, address indexed to, uint256 sharesValue)",
    ]);
    const rewardsInterface = new Interface([
      "event RewardsAdded(uint256 amount, uint256 newTotalPooled)",
    ]);
    const from = "0x1111111111111111111111111111111111111111";
    const to = "0x2222222222222222222222222222222222222222";
    const firstTransfer = shareInterface.encodeEventLog(
      shareInterface.getEvent("TransferShares")!,
      [from, to, 10n],
    );
    const secondTransfer = shareInterface.encodeEventLog(
      shareInterface.getEvent("TransferShares")!,
      [from, to, 5n],
    );
    const rewards = rewardsInterface.encodeEventLog(
      rewardsInterface.getEvent("RewardsAdded")!,
      [50n, 1_050n],
    );

    prismaMocks.tx.stAethelTransfer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaMocks.tx.stAethelBalance.findUnique
      .mockResolvedValueOnce({ shares: "100" })
      .mockResolvedValueOnce({ shares: "0" })
      .mockResolvedValueOnce({ shares: "90" })
      .mockResolvedValueOnce({ shares: "10" });
    const refreshVault = vi
      .spyOn(service as any, "refreshVaultState")
      .mockResolvedValue(undefined);

    await (service as any).handleTransferSharesEvent(
      makeLog({ topics: firstTransfer.topics, data: firstTransfer.data }),
      new Date(),
    );
    await (service as any).handleRewardsAddedEvent(
      makeLog({ topics: rewards.topics, data: rewards.data, index: 4 }),
    );
    await (service as any).handleTransferSharesEvent(
      makeLog({
        topics: secondTransfer.topics,
        data: secondTransfer.data,
        index: 5,
        transactionHash: "0x" + "55".repeat(32),
      }),
      new Date(),
    );

    expect(refreshVault).toHaveBeenCalledOnce();
    expect(
      prismaMocks.tx.stAethelBalance.upsert.mock.calls.map(
        ([query]) => query.update.shares,
      ),
    ).toEqual(["90", "10", "85", "15"]);
  });

  it("rebuilds the invariant share ledger from surviving TransferShares events", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    const tokenAddress = "0x9999999999999999999999999999999999999999";
    const holderA = "0x1111111111111111111111111111111111111111";
    const holderB = "0x2222222222222222222222222222222222222222";
    const zero = "0x0000000000000000000000000000000000000000";
    const shareInterface = new Interface([
      "event TransferShares(address indexed from, address indexed to, uint256 sharesValue)",
    ]);
    const mint = shareInterface.encodeEventLog(
      shareInterface.getEvent("TransferShares")!,
      [zero, holderA, 100n],
    );
    const transfer = shareInterface.encodeEventLog(
      shareInterface.getEvent("TransferShares")!,
      [holderA, holderB, 25n],
    );
    (service as any).cfg.staethelAddress = tokenAddress;
    prismaMocks.eventFindMany.mockResolvedValue([
      {
        blockHeight: 1n,
        transactionHash: "0x" + "11".repeat(32),
        logIndex: 1,
        attributes: {
          address: tokenAddress,
          topics: mint.topics,
          data: mint.data,
        },
        timestamp: new Date(1_000),
      },
      {
        blockHeight: 2n,
        transactionHash: "0x" + "22".repeat(32),
        logIndex: 3,
        attributes: {
          address: tokenAddress,
          topics: transfer.topics,
          data: transfer.data,
        },
        timestamp: new Date(2_000),
      },
    ]);

    await (service as any).rebuildStAethelBalances();

    expect(prismaMocks.eventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "TransferShares" }),
      }),
    );
    expect(
      prismaMocks.stAethelTransferCreate.mock.calls.map(
        ([query]) => query.data.shares,
      ),
    ).toEqual(["100", "25"]);
    expect(
      prismaMocks.stAethelBalanceCreate.mock.calls.map(([query]) => ({
        holder: query.data.holder,
        shares: query.data.shares,
      })),
    ).toEqual([
      { holder: holderA, shares: "75" },
      { holder: holderB, shares: "25" },
    ]);
  });

  it("persists multiple stake logs from the same transaction independently", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    const stakeInterface = new Interface([
      "event Staked(address indexed user, uint256 amount, uint256 shares)",
    ]);
    const transactionHash = "0x" + "77".repeat(32);
    const first = stakeInterface.encodeEventLog(
      stakeInterface.getEvent("Staked")!,
      ["0x1111111111111111111111111111111111111111", 10n, 9n],
    );
    const second = stakeInterface.encodeEventLog(
      stakeInterface.getEvent("Staked")!,
      ["0x2222222222222222222222222222222222222222", 20n, 18n],
    );

    await (service as any).handleStakedEvent(
      makeLog({
        transactionHash,
        index: 3,
        topics: first.topics,
        data: first.data,
      }),
      new Date(),
    );
    await (service as any).handleStakedEvent(
      makeLog({
        transactionHash,
        index: 4,
        topics: second.topics,
        data: second.data,
      }),
      new Date(),
    );

    expect(prismaMocks.vaultStakeUpsert).toHaveBeenCalledTimes(2);
    expect(
      prismaMocks.vaultStakeUpsert.mock.calls.map(
        ([query]) => query.where.txHash_logIndex,
      ),
    ).toEqual([
      { txHash: transactionHash, logIndex: 3 },
      { txHash: transactionHash, logIndex: 4 },
    ]);
  });

  it("uses the immutable Unstaked event deadline during historical replay", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    const unstakeInterface = new Interface([
      "event Unstaked(address indexed user, uint256 shares, uint256 amount, uint256 withdrawalId, uint256 completionTime)",
    ]);
    const completionTimeSeconds = 1_800_000_000n;
    const encoded = unstakeInterface.encodeEventLog(
      unstakeInterface.getEvent("Unstaked")!,
      [
        "0x1111111111111111111111111111111111111111",
        25n,
        30n,
        7n,
        completionTimeSeconds,
      ],
    );

    await (service as any).handleUnstakedEvent(
      makeLog({ topics: encoded.topics, data: encoded.data }),
      new Date("2024-01-01T00:00:00.000Z"),
    );

    expect(prismaMocks.vaultUnstakeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { withdrawalId: 7n },
        create: expect.objectContaining({
          completionTime: new Date(Number(completionTimeSeconds) * 1000),
          sourceProvenance: "CANONICAL_EVENT",
        }),
      }),
    );
  });

  it("clears the projection visibility barrier only with the cursor commit", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).pendingBlockNumber = 101;

    await (service as any).updateCursor(
      101,
      "0x" + "aa".repeat(32),
      new Date("2026-07-18T00:00:00.000Z"),
    );

    expect(prismaMocks.transaction).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ]);
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blockNumber: 101n,
          pendingBlockNumber: null,
        }),
      }),
    );
    expect((service as any).pendingBlockNumber).toBeNull();
    expect(service.indexedHead).toBe(101);
  });

  it("removes reorged stablecoin projections and rebuilds all derived state", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    const rebuildBalances = vi
      .spyOn(service as any, "rebuildStAethelBalances")
      .mockResolvedValue(undefined);
    const rebuildUnstakes = vi
      .spyOn(service as any, "rebuildVaultUnstakeStatuses")
      .mockResolvedValue(undefined);
    const rebuildStablecoins = vi
      .spyOn(service as any, "rebuildStablecoinConfigs")
      .mockResolvedValue(undefined);
    const refreshVault = vi
      .spyOn(service as any, "refreshVaultState")
      .mockResolvedValue(undefined);

    await (service as any).rollbackFromBlock(100, 102);

    expect(prismaMocks.deleteStablecoinBridgeEvents).toHaveBeenCalledWith({
      where: { blockNumber: { gte: 100n } },
    });
    expect(prismaMocks.deleteStablecoinConfigs).toHaveBeenCalledWith({
      where: { blockNumber: { gte: 100n } },
    });
    expect(prismaMocks.deleteVaultState).toHaveBeenCalledWith({});
    expect(rebuildBalances).toHaveBeenCalledOnce();
    expect(rebuildUnstakes).toHaveBeenCalledOnce();
    expect(rebuildStablecoins).toHaveBeenCalledOnce();
    expect(refreshVault).toHaveBeenCalledWith(99);
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          blockNumber: 99n,
          requiresRebuild: true,
          recoveryTargetBlock: 102n,
        }),
      }),
    );
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledOnce();
    expect((service as any).materializedStateRebuildRequired).toBe(true);
    expect((service as any).materializedStateRebuildCompleted).toBe(true);

    await (service as any).completeMaterializedStateRecoveryIfReady(101);
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledOnce();

    await (service as any).completeMaterializedStateRecoveryIfReady(102);
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenLastCalledWith({
      where: { cursorKey: "evm-indexer" },
      data: { requiresRebuild: false, recoveryTargetBlock: null },
    });
  });

  it("re-indexes the canonical range directly while the outer processing lock is held", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).running = true;
    (service as any).processingLock = true;
    (service as any).httpProvider = {
      getBlock: vi.fn().mockResolvedValue({
        hash: "0x" + "aa".repeat(32),
        number: 1,
      }),
    };
    prismaMocks.blockFindUnique.mockResolvedValue({
      hash: "0x" + "bb".repeat(32),
    });

    const rollback = vi
      .spyOn(service as any, "rollbackFromBlock")
      .mockResolvedValue(undefined);
    const indexBlock = vi
      .spyOn(service as any, "indexBlockWithRetry")
      .mockResolvedValue(undefined);

    await (service as any).handleReorg(100, 102);

    expect(rollback).toHaveBeenCalledWith(100, 102);
    expect(indexBlock.mock.calls.map(([blockNumber]) => blockNumber)).toEqual([
      100, 101, 102,
    ]);
    expect(prismaMocks.reorgEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromBlock: 100n,
        toBlock: 102n,
        depth: 3,
      }),
    });
  });

  it("fails closed when a reorg has no proven common ancestor", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    const storedHash = "0x" + "11".repeat(32);
    prismaMocks.blockFindUnique
      .mockResolvedValueOnce({ hash: storedHash })
      .mockResolvedValueOnce(null);
    (service as any).httpProvider = {
      getBlock: vi.fn().mockResolvedValue({
        hash: "0x" + "22".repeat(32),
        parentHash: "0x" + "33".repeat(32),
      }),
    };

    await expect((service as any).detectReorg(100)).rejects.toThrow(
      "no proven common ancestor",
    );
  });

  it("keeps the durable rebuild marker set when projection repair fails", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    vi.spyOn(service as any, "rebuildStAethelBalances").mockRejectedValue(
      new Error("projection rebuild failed"),
    );

    await expect((service as any).rollbackFromBlock(100, 102)).rejects.toThrow(
      "projection rebuild failed",
    );

    expect((service as any).indexedHead).toBe(99);
    expect((service as any).materializedStateRebuildRequired).toBe(true);
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledOnce();
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requiresRebuild: true }),
      }),
    );
  });

  it("resumes a durable rebuild marker before indexing after restart", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).verifiedHttpChainId = "31337";
    (service as any).verifiedHttpAnchorHash = "0x" + "ab".repeat(32);
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 99n,
      requiresRebuild: true,
      recoveryTargetBlock: 102n,
      networkChainId: "31337",
      networkAnchorHash: "0x" + "ab".repeat(32),
    });

    await (service as any).ensureCursor();

    expect((service as any).indexedHead).toBe(99);
    expect((service as any).materializedStateRebuildRequired).toBe(true);
    expect((service as any).materializedStateRecoveryTarget).toBe(102);

    (service as any).running = true;
    const callOrder: string[] = [];
    vi.spyOn(service as any, "rebuildMaterializedState").mockImplementation(
      async () => {
        callOrder.push("rebuild");
        (service as any).materializedStateRebuildRequired = false;
      },
    );
    vi.spyOn(service as any, "detectReorg").mockImplementation(async () => {
      callOrder.push("detect");
      return null;
    });
    vi.spyOn(service as any, "indexBlockWithRetry").mockImplementation(
      async () => {
        callOrder.push("index");
      },
    );

    await (service as any).processBlockRange(100, 100);

    expect(callOrder).toEqual(["rebuild", "detect", "index"]);
  });

  it("refuses to reuse a cursor bound to another same-chain-id network", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).verifiedHttpChainId = "7332";
    (service as any).verifiedHttpAnchorHash = "0x" + "aa".repeat(32);
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 99n,
      requiresRebuild: false,
      recoveryTargetBlock: null,
      pendingBlockNumber: null,
      networkChainId: "7332",
      networkAnchorHash: "0x" + "bb".repeat(32),
    });

    await expect((service as any).ensureCursor()).rejects.toThrow(
      "Refusing to reuse cursor bound to",
    );
    expect(prismaMocks.syncStateUpsert).not.toHaveBeenCalled();
  });

  it("refuses ambiguous legacy adoption after another vault namespace exists", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const { buildIndexerNetworkKeys } =
      await import("../src/lib/indexerNetworkIdentity");
    const service = new IndexerService({} as any);
    const identity = {
      chainId: "7332",
      anchorHash: "0x" + "aa".repeat(32),
      vaultAddress: "0x1111111111111111111111111111111111111111",
    };
    (service as any).verifiedHttpChainId = identity.chainId;
    (service as any).verifiedHttpAnchorHash = identity.anchorHash;
    (service as any).networkKeys = buildIndexerNetworkKeys(identity);
    prismaMocks.indexerCursorFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        blockNumber: 99n,
        blockHash: "0x" + "bb".repeat(32),
        timestamp: new Date(),
        requiresRebuild: false,
        recoveryTargetBlock: null,
        pendingBlockNumber: null,
        networkChainId: identity.chainId,
        networkAnchorHash: identity.anchorHash,
        networkVaultAddress: null,
      });
    prismaMocks.indexerCursorFindFirst.mockResolvedValue({
      cursorKey: "evm-indexer:another-vault",
    });

    await expect((service as any).ensureCursor()).rejects.toThrow(
      "Refusing ambiguous legacy cursor adoption",
    );

    expect(prismaMocks.indexerCursorCreate).not.toHaveBeenCalled();
    expect(prismaMocks.indexerCursorUpdate).not.toHaveBeenCalled();
    expect(prismaMocks.syncStateUpsert).not.toHaveBeenCalled();
  });

  it("adopts an unambiguous legacy cursor once and binds every indexed source atomically", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const { buildIndexerNetworkKeys } =
      await import("../src/lib/indexerNetworkIdentity");
    const service = new IndexerService({} as any);
    const identity = {
      chainId: "7332",
      anchorHash: "0x" + "aa".repeat(32),
      vaultAddress: "0x1111111111111111111111111111111111111111",
      staethelAddress: "0x2222222222222222222222222222222222222222",
      stablecoinBridgeAddress: "0x3333333333333333333333333333333333333333",
    };
    const networkKeys = buildIndexerNetworkKeys(identity);
    const legacyCursor = {
      blockNumber: 99n,
      blockHash: "0x" + "bb".repeat(32),
      timestamp: new Date(),
      requiresRebuild: true,
      recoveryTargetBlock: 102n,
      pendingBlockNumber: null,
      networkChainId: null,
      networkAnchorHash: null,
      networkVaultAddress: null,
      networkStaethelAddress: null,
      networkStablecoinBridgeAddress: null,
    };
    const adoptedCursor = {
      ...legacyCursor,
      cursorKey: networkKeys.cursorKey,
      networkChainId: identity.chainId,
      networkAnchorHash: identity.anchorHash,
      networkVaultAddress: identity.vaultAddress,
      networkStaethelAddress: identity.staethelAddress,
      networkStablecoinBridgeAddress: identity.stablecoinBridgeAddress,
    };
    (service as any).verifiedHttpChainId = identity.chainId;
    (service as any).verifiedHttpAnchorHash = identity.anchorHash;
    (service as any).networkKeys = networkKeys;
    prismaMocks.indexerCursorFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyCursor);
    prismaMocks.indexerCursorFindFirst.mockResolvedValue(null);
    prismaMocks.indexerCursorCreate.mockResolvedValue(adoptedCursor);

    await (service as any).ensureCursor();

    expect(prismaMocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledWith({
      where: { cursorKey: "evm-indexer" },
      data: {
        networkChainId: identity.chainId,
        networkAnchorHash: identity.anchorHash,
        networkVaultAddress: identity.vaultAddress,
        networkStaethelAddress: identity.staethelAddress,
        networkStablecoinBridgeAddress: identity.stablecoinBridgeAddress,
      },
    });
    expect(prismaMocks.indexerCursorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cursorKey: networkKeys.cursorKey,
          blockNumber: 99n,
          networkStablecoinBridgeAddress: identity.stablecoinBridgeAddress,
        }),
      }),
    );
    expect((service as any).indexedHead).toBe(99);
    expect((service as any).materializedStateRebuildRequired).toBe(true);
    expect((service as any).materializedStateRecoveryTarget).toBe(102);
  });

  it("refuses to resume legacy history after an indexed source address changes", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const { buildIndexerNetworkKeys } =
      await import("../src/lib/indexerNetworkIdentity");
    const service = new IndexerService({} as any);
    const identity = {
      chainId: "7332",
      anchorHash: "0x" + "aa".repeat(32),
      vaultAddress: "0x1111111111111111111111111111111111111111",
      staethelAddress: "0x2222222222222222222222222222222222222222",
      stablecoinBridgeAddress: "0x3333333333333333333333333333333333333333",
    };
    (service as any).verifiedHttpChainId = identity.chainId;
    (service as any).verifiedHttpAnchorHash = identity.anchorHash;
    (service as any).networkKeys = buildIndexerNetworkKeys(identity);
    prismaMocks.indexerCursorFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        blockNumber: 99n,
        blockHash: "0x" + "bb".repeat(32),
        timestamp: new Date(),
        requiresRebuild: false,
        recoveryTargetBlock: null,
        pendingBlockNumber: null,
        networkChainId: identity.chainId,
        networkAnchorHash: identity.anchorHash,
        networkVaultAddress: identity.vaultAddress,
        networkStaethelAddress: "0x4444444444444444444444444444444444444444",
        networkStablecoinBridgeAddress: identity.stablecoinBridgeAddress,
      });

    await expect((service as any).ensureCursor()).rejects.toThrow(
      "Refusing to adopt a legacy cursor bound to another indexed source identity",
    );

    expect(prismaMocks.indexerCursorCreate).not.toHaveBeenCalled();
    expect(prismaMocks.syncStateUpsert).not.toHaveBeenCalled();
  });

  it("uses the legacy cursor consistently when expected identity is incomplete", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).cfg = {
      ...(service as any).cfg,
      expectedChainId: undefined,
      expectedGenesisHash: undefined,
      cruzibleVaultAddress: "0x1111111111111111111111111111111111111111",
    };
    (service as any).httpProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 7332n }),
      getBlock: vi.fn().mockResolvedValue({
        hash: "0x" + "aa".repeat(32),
        number: 1,
      }),
    };

    await (service as any).assertExpectedChainId();

    expect((service as any).networkKeys).toBeNull();
    expect((service as any).getCursorKey()).toBe("evm-indexer");
  });

  it("stays fail-closed when recovery stops after rebuild but before canonical replay", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).running = true;
    (service as any).httpProvider = {
      getBlock: vi.fn().mockResolvedValue({
        hash: "0x" + "aa".repeat(32),
      }),
    };
    prismaMocks.blockFindUnique.mockResolvedValue({
      hash: "0x" + "bb".repeat(32),
    });
    vi.spyOn(service as any, "rebuildStAethelBalances").mockResolvedValue(
      undefined,
    );
    vi.spyOn(service as any, "rebuildVaultUnstakeStatuses").mockResolvedValue(
      undefined,
    );
    vi.spyOn(service as any, "rebuildStablecoinConfigs").mockResolvedValue(
      undefined,
    );
    vi.spyOn(service as any, "refreshVaultState").mockResolvedValue(undefined);
    vi.spyOn(service as any, "indexBlockWithRetry").mockRejectedValueOnce(
      new Error("worker stopped before canonical replay"),
    );

    await expect((service as any).handleReorg(100, 102)).rejects.toThrow(
      "worker stopped before canonical replay",
    );

    expect((service as any).indexedHead).toBe(99);
    expect((service as any).materializedStateRebuildRequired).toBe(true);
    expect((service as any).materializedStateRebuildCompleted).toBe(true);
    expect((service as any).materializedStateRecoveryTarget).toBe(102);
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledOnce();
    expect(prismaMocks.indexerCursorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requiresRebuild: true,
          recoveryTargetBlock: 102n,
        }),
      }),
    );
  });

  it("retries a failed materialized rebuild on the next range before indexing", async () => {
    const { IndexerService } = await import("../src/services/IndexerService");
    const service = new IndexerService({} as any);
    (service as any).running = true;
    (service as any).materializedStateRebuildRequired = true;

    const rebuild = vi
      .spyOn(service as any, "rebuildMaterializedState")
      .mockRejectedValueOnce(new Error("temporary projection repair failure"))
      .mockImplementationOnce(async () => {
        (service as any).materializedStateRebuildRequired = false;
      });
    const detectReorg = vi
      .spyOn(service as any, "detectReorg")
      .mockResolvedValue(null);
    const indexBlock = vi
      .spyOn(service as any, "indexBlockWithRetry")
      .mockResolvedValue(undefined);

    await expect((service as any).processBlockRange(100, 100)).rejects.toThrow(
      "temporary projection repair failure",
    );
    expect((service as any).processingLock).toBe(false);
    expect(detectReorg).not.toHaveBeenCalled();
    expect(indexBlock).not.toHaveBeenCalled();

    await (service as any).processBlockRange(100, 100);

    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(detectReorg).toHaveBeenCalledWith(100);
    expect(indexBlock).toHaveBeenCalledWith(100);
  });
});
