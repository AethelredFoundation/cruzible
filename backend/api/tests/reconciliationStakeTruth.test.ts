import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  indexerCursorFindUnique: vi.fn(),
  vaultStateFindFirst: vi.fn(),
  stAethelBalanceFindMany: vi.fn(),
  vaultUnstakeCount: vi.fn(),
  vaultWithdrawalCount: vi.fn(),
  vaultRewardCount: vi.fn(),
  legacyDelegationFindMany: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  const MockPrismaClient = vi.fn().mockImplementation(function () {
    return {
      $transaction: prismaMocks.transaction,
      indexerCursor: { findUnique: prismaMocks.indexerCursorFindUnique },
      vaultState: { findFirst: prismaMocks.vaultStateFindFirst },
      stAethelBalance: { findMany: prismaMocks.stAethelBalanceFindMany },
      vaultUnstake: { count: prismaMocks.vaultUnstakeCount },
      vaultWithdrawal: { count: prismaMocks.vaultWithdrawalCount },
      vaultReward: { count: prismaMocks.vaultRewardCount },
      // This legacy table is intentionally present in the mock so the test can
      // prove reconciliation no longer fabricates a holder-to-validator join.
      delegation: { findMany: prismaMocks.legacyDelegationFindMany },
    };
  });

  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" },
    },
  };
});

describe("ReconciliationService pooled-vault stake truth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.transaction.mockImplementation(async (operation) =>
      operation({
        indexerCursor: {
          findUnique: prismaMocks.indexerCursorFindUnique,
        },
        vaultState: { findFirst: prismaMocks.vaultStateFindFirst },
        stAethelBalance: { findMany: prismaMocks.stAethelBalanceFindMany },
        vaultUnstake: { count: prismaMocks.vaultUnstakeCount },
        vaultWithdrawal: { count: prismaMocks.vaultWithdrawalCount },
        vaultReward: { count: prismaMocks.vaultRewardCount },
      }),
    );
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 100n,
      pendingBlockNumber: null,
      requiresRebuild: false,
    });
    prismaMocks.vaultStateFindFirst.mockResolvedValue({ totalShares: "100" });
    prismaMocks.stAethelBalanceFindMany.mockResolvedValue([
      {
        holder: "0x1111111111111111111111111111111111111111",
        shares: "60",
      },
      {
        holder: "0x2222222222222222222222222222222222222222",
        shares: "40",
      },
    ]);
    prismaMocks.vaultUnstakeCount.mockResolvedValue(0);
    prismaMocks.vaultWithdrawalCount.mockResolvedValue(0);
    prismaMocks.vaultRewardCount.mockResolvedValue(0);
  });

  it("reconciles aggregate transferable share supply without inventing validator ownership", async () => {
    const { ReconciliationService } =
      await import("../src/services/ReconciliationService");
    const service = new ReconciliationService({} as any);
    const warnings: string[] = [];
    const discrepancies: any[] = [];

    const result = await (service as any).buildStakeSupply(
      warnings,
      discrepancies,
    );

    expect(prismaMocks.legacyDelegationFindMany).not.toHaveBeenCalled();
    expect(prismaMocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(result).toEqual({
      stake_supply: {
        observed: {
          holder_total_shares: "100",
          vault_total_shares: "100",
        },
        meta: {
          holder_count: 2,
          matches_vault_total: true,
        },
      },
    });
    expect(result.stake_snapshot).toBeUndefined();
    expect(discrepancies).toContainEqual(
      expect.objectContaining({
        code: "PER_HOLDER_VALIDATOR_ATTRIBUTION_UNAVAILABLE",
        severity: "WARNING",
        evidence: expect.objectContaining({
          attribution_model: "pooled-vault",
        }),
      }),
    );
    expect(discrepancies).not.toContainEqual(
      expect.objectContaining({ code: "MISSING_ACTIVE_DELEGATION" }),
    );
  });

  it("withholds an interleaved stake generation instead of reporting a false mismatch", async () => {
    prismaMocks.indexerCursorFindUnique.mockResolvedValue({
      blockNumber: 100n,
      pendingBlockNumber: 101n,
      requiresRebuild: false,
    });
    prismaMocks.vaultStateFindFirst.mockResolvedValue({ totalShares: "100" });
    prismaMocks.stAethelBalanceFindMany.mockResolvedValue([
      {
        holder: "0x1111111111111111111111111111111111111111",
        shares: "110",
      },
    ]);

    const { ReconciliationService } =
      await import("../src/services/ReconciliationService");
    const service = new ReconciliationService({} as any);
    const discrepancies: any[] = [];

    const result = await (service as any).buildStakeSupply([], discrepancies);

    expect(result).toEqual({});
    expect(prismaMocks.vaultStateFindFirst).not.toHaveBeenCalled();
    expect(prismaMocks.stAethelBalanceFindMany).not.toHaveBeenCalled();
    expect(discrepancies).toContainEqual(
      expect.objectContaining({
        code: "INDEXER_GENERATION_UNCOMMITTED",
        severity: "CRITICAL",
        evidence: expect.objectContaining({
          committed_block: "100",
          pending_block: "101",
        }),
      }),
    );
    expect(discrepancies).not.toContainEqual(
      expect.objectContaining({ code: "STAKE_SUPPLY_MISMATCH" }),
    );
  });

  it("withholds projections when the cursor is bound to another indexed source", async () => {
    const { config } = await import("../src/config");
    const mutableConfig = config as unknown as {
      indexerExpectedChainId?: string;
      indexerExpectedGenesisHash?: string;
      cruzibleVaultAddress: string;
      staethelAddress: string;
      stablecoinBridgeAddress: string;
    };
    const original = {
      indexerExpectedChainId: mutableConfig.indexerExpectedChainId,
      indexerExpectedGenesisHash: mutableConfig.indexerExpectedGenesisHash,
      cruzibleVaultAddress: mutableConfig.cruzibleVaultAddress,
      staethelAddress: mutableConfig.staethelAddress,
      stablecoinBridgeAddress: mutableConfig.stablecoinBridgeAddress,
    };
    Object.assign(mutableConfig, {
      indexerExpectedChainId: "7332",
      indexerExpectedGenesisHash: "0x" + "aa".repeat(32),
      cruzibleVaultAddress: "0x1111111111111111111111111111111111111111",
      staethelAddress: "0x2222222222222222222222222222222222222222",
      stablecoinBridgeAddress: "0x3333333333333333333333333333333333333333",
    });
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

    try {
      const { ReconciliationService } =
        await import("../src/services/ReconciliationService");
      const service = new ReconciliationService({} as any);
      const discrepancies: any[] = [];

      const result = await (service as any).buildStakeSupply([], discrepancies);

      expect(result).toEqual({});
      expect(prismaMocks.vaultStateFindFirst).not.toHaveBeenCalled();
      expect(prismaMocks.stAethelBalanceFindMany).not.toHaveBeenCalled();
      expect(discrepancies).toContainEqual(
        expect.objectContaining({
          code: "INDEXER_GENERATION_IDENTITY_MISMATCH",
          severity: "CRITICAL",
        }),
      );
    } finally {
      Object.assign(mutableConfig, original);
    }
  });

  it("fails aggregate reconciliation when holder shares diverge from vault totalShares", async () => {
    prismaMocks.stAethelBalanceFindMany.mockResolvedValue([
      {
        holder: "0x1111111111111111111111111111111111111111",
        shares: "95",
      },
    ]);
    const { ReconciliationService } =
      await import("../src/services/ReconciliationService");
    const service = new ReconciliationService({} as any);
    const discrepancies: any[] = [];

    const result = await (service as any).buildStakeSupply([], discrepancies);

    expect(result.stake_supply.meta.matches_vault_total).toBe(false);
    expect(discrepancies).toContainEqual(
      expect.objectContaining({
        code: "STAKE_SUPPLY_MISMATCH",
        severity: "CRITICAL",
        affected_shares: "5",
      }),
    );
  });

  it("gives same-count captures different identities when aggregate supply changes", async () => {
    const { ReconciliationService } =
      await import("../src/services/ReconciliationService");
    const service = new ReconciliationService({} as any);
    const baseDocument = {
      epoch: 7,
      source: { chain_height: 100 },
      validator_selection: {
        observed: { universe_hash: "0xuniverse" },
      },
      warnings: ["attribution unavailable"],
      discrepancies: [
        {
          code: "PER_HOLDER_VALIDATOR_ATTRIBUTION_UNAVAILABLE",
          severity: "WARNING",
          affected_accounts: 2,
          affected_shares: "100",
          evidence: { attribution_model: "pooled-vault" },
        },
      ],
      stake_supply: {
        observed: {
          holder_total_shares: "100",
          vault_total_shares: "100",
        },
        meta: { holder_count: 2, matches_vault_total: true },
      },
    };
    const changedSupply = {
      ...baseDocument,
      stake_supply: {
        observed: {
          holder_total_shares: "110",
          vault_total_shares: "110",
        },
        meta: { holder_count: 2, matches_vault_total: true },
      },
      discrepancies: [
        {
          ...baseDocument.discrepancies[0],
          affected_shares: "110",
        },
      ],
    };

    const firstKey = (service as any).buildSnapshotKey(baseDocument);
    const changedKey = (service as any).buildSnapshotKey(changedSupply);

    expect(firstKey).toMatch(/^v2:7:[a-f0-9]{64}$/);
    expect(changedKey).toMatch(/^v2:7:[a-f0-9]{64}$/);
    expect(changedKey).not.toBe(firstKey);
  });
});
