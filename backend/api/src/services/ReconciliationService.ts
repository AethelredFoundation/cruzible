import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { singleton } from "tsyringe";
import { BlockchainService } from "./BlockchainService";
import { bytesToHex, computeEligibleUniverseHash } from "../lib/protocolSdk";
import { resolveProtocolEpoch } from "../lib/protocolEpoch";
import {
  getConfiguredIndexerCursorKey,
  getConfiguredIndexerNetworkKeys,
} from "../lib/indexerNetworkIdentity";

type LiveReconciliationOptions = {
  validatorLimit: number;
  /**
   * Public live reads should not mutate snapshot history. Persist defaults
   * to true so explicit operator capture paths keep writing audit evidence.
   */
  persist?: boolean;
};

type ControlPlaneSummaryOptions = {
  persist?: boolean;
};

export type ReconciliationDiscrepancy = {
  code: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status: "ACTIVE";
  title: string;
  message: string;
  affected_accounts: number;
  affected_shares?: string;
  impact_bps?: number;
  sample_addresses: string[];
  evidence?: Record<string, unknown>;
  remediation?: string;
};

export type ReconciliationControlPlaneSummary = {
  epoch: number;
  epoch_source: string;
  captured_at: string;
  chain_height: number;
  validator_count: number;
  total_eligible_validators: number;
  validator_universe_hash: string;
  stake_snapshot_hash?: string;
  stake_snapshot_complete: boolean | null;
  warning_count: number;
  discrepancy_count: number;
  critical_discrepancy_count: number;
  warning_discrepancy_count: number;
  info_discrepancy_count: number;
  warnings: string[];
};

export type ReconciliationSnapshotHistoryEntry = {
  snapshot_id: string;
  snapshot_key: string;
  epoch: number;
  captured_at: string;
  validator_universe_hash: string;
  stake_snapshot_hash?: string;
  warning_count: number;
  discrepancy_count: number;
  status: "OK" | "WARNING" | "CRITICAL";
  epoch_source: string;
  chain_height: number;
  stake_snapshot_complete: boolean | null;
};

export type HistoricalReconciliationSnapshot = {
  snapshot_id: string;
  snapshot_key: string;
  status: "OK" | "WARNING" | "CRITICAL";
  created_at: string;
  document: LiveReconciliationDocument;
  discrepancies: ReconciliationDiscrepancy[];
};

export type LiveReconciliationDocument = {
  epoch: number;
  network: string;
  mode: "live-snapshot";
  captured_at: string;
  source: {
    epoch_source: string;
    validator_source: string;
    stake_source: string;
    validator_limit: number;
    validator_count: number;
    total_eligible_validators: number;
    chain_height: number;
  };
  warnings: string[];
  discrepancies: ReconciliationDiscrepancy[];
  validator_selection: {
    input: {
      eligible_addresses: string[];
    };
    observed: {
      universe_hash: string;
    };
    meta: {
      validator_count: number;
      total_eligible_validators: number;
    };
  };
  stake_supply?: {
    observed: {
      holder_total_shares: string;
      vault_total_shares?: string;
    };
    meta: {
      holder_count: number;
      matches_vault_total: boolean | null;
    };
  };
  /**
   * Historical documents may contain this legacy shape. New live captures do
   * not produce it until the protocol exposes canonical allocation evidence;
   * transferable stAETHEL holders cannot be assigned to a validator target.
   */
  stake_snapshot?: {
    input: {
      stakers: {
        address: string;
        shares: string;
        delegated_to: string;
      }[];
    };
    observed: {
      stake_snapshot_hash: string;
      staker_registry_root?: string;
      delegation_registry_root?: string;
      delegation_payload_hex?: string;
    };
    meta: {
      total_candidate_stakers: number;
      included_stakers: number;
      skipped_stakers: number;
      included_total_shares: string;
      vault_total_shares?: string;
      registry_roots_available: boolean;
      complete: boolean;
    };
  };
};

type LiveStakeSupplyBuildResult = {
  stake_supply?: LiveReconciliationDocument["stake_supply"];
  stake_snapshot?: LiveReconciliationDocument["stake_snapshot"];
};

@singleton()
export class ReconciliationService {
  private prisma: PrismaClient;
  private disconnected = false;

  constructor(private blockchainService: BlockchainService) {
    this.prisma = new PrismaClient();
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) {
      return;
    }

    this.disconnected = true;
    await this.prisma.$disconnect();
  }

  private async getCurrentEpoch(
    warnings: string[],
    discrepancies: ReconciliationDiscrepancy[],
  ): Promise<{ epoch: number; source: string }> {
    const resolved = await resolveProtocolEpoch({
      blockchainService: this.blockchainService,
    });

    if (resolved.warning) {
      this.pushDiscrepancy(discrepancies, warnings, {
        code: "EPOCH_FALLBACK",
        severity: "WARNING",
        title: "Authoritative epoch unavailable",
        message: resolved.warning,
        evidence: {
          epoch_source: resolved.source,
          epoch: resolved.epoch,
        },
        remediation:
          "Restore the canonical vault currentEpoch() source before treating this capture as fully canonical.",
      });
    }

    return { epoch: resolved.epoch, source: resolved.source };
  }

  async getLiveDocument(
    options: LiveReconciliationOptions,
  ): Promise<LiveReconciliationDocument> {
    const warnings: string[] = [];
    const discrepancies: ReconciliationDiscrepancy[] = [];

    const { epoch, source: epochSource } = await this.getCurrentEpoch(
      warnings,
      discrepancies,
    );
    const chainHeight = await this.blockchainService.getLatestHeight();

    const allValidators = await this.blockchainService.getValidators({
      limit: 10_000,
      offset: 0,
      status: "BOND_STATUS_BONDED",
    });
    const allEligibleAddresses = allValidators.data.map(
      (validator) => validator.address,
    );
    const universeHash = bytesToHex(
      computeEligibleUniverseHash(allEligibleAddresses),
    );
    const presentedAddresses = allEligibleAddresses.slice(
      0,
      options.validatorLimit,
    );
    const capturedAt = new Date().toISOString();

    if (presentedAddresses.length < allEligibleAddresses.length) {
      this.pushDiscrepancy(discrepancies, warnings, {
        code: "VALIDATOR_VIEW_TRUNCATED",
        severity: "INFO",
        title: "Validator presentation truncated",
        message: `The public document is displaying the first ${presentedAddresses.length} validators while the canonical universe hash covers ${allEligibleAddresses.length} eligible validators.`,
        evidence: {
          displayed_validator_count: presentedAddresses.length,
          hashed_validator_count: allEligibleAddresses.length,
          validator_limit: options.validatorLimit,
        },
        remediation:
          "Use the immutable history or per-epoch retrieval endpoints to audit the canonical universe across time.",
      });
    }

    const { stake_supply, stake_snapshot } = await this.buildStakeSupply(
      warnings,
      discrepancies,
    );

    const document: LiveReconciliationDocument = {
      epoch,
      network: "aethelred",
      mode: "live-snapshot",
      captured_at: capturedAt,
      source: {
        epoch_source: epochSource,
        validator_source: "rpc/staking.validators",
        stake_source: "indexer.stAethelBalance.shares+vaultState.totalShares",
        validator_limit: options.validatorLimit,
        validator_count: presentedAddresses.length,
        total_eligible_validators: allEligibleAddresses.length,
        chain_height: chainHeight,
      },
      warnings,
      discrepancies,
      validator_selection: {
        input: {
          eligible_addresses: presentedAddresses,
        },
        observed: {
          universe_hash: universeHash,
        },
        meta: {
          validator_count: presentedAddresses.length,
          total_eligible_validators: allEligibleAddresses.length,
        },
      },
      ...(stake_supply ? { stake_supply } : {}),
      ...(stake_snapshot ? { stake_snapshot } : {}),
    };

    if (options.persist !== false) {
      await this.persistSnapshot(document);
    }

    return document;
  }

  async getControlPlaneSummary(
    options: ControlPlaneSummaryOptions = {},
  ): Promise<ReconciliationControlPlaneSummary> {
    const document = await this.getLiveDocument({
      validatorLimit: 200,
      persist: options.persist,
    });

    return {
      epoch: document.epoch,
      epoch_source: document.source.epoch_source,
      captured_at: document.captured_at,
      chain_height: document.source.chain_height,
      validator_count: document.validator_selection.meta.validator_count,
      total_eligible_validators:
        document.validator_selection.meta.total_eligible_validators,
      validator_universe_hash:
        document.validator_selection.observed.universe_hash,
      ...(document.stake_snapshot?.observed?.stake_snapshot_hash
        ? {
            stake_snapshot_hash:
              document.stake_snapshot.observed.stake_snapshot_hash,
          }
        : {}),
      stake_snapshot_complete: document.stake_snapshot?.meta?.complete ?? null,
      warning_count: document.warnings.length,
      discrepancy_count: document.discrepancies.length,
      critical_discrepancy_count: document.discrepancies.filter(
        (discrepancy) => discrepancy.severity === "CRITICAL",
      ).length,
      warning_discrepancy_count: document.discrepancies.filter(
        (discrepancy) => discrepancy.severity === "WARNING",
      ).length,
      info_discrepancy_count: document.discrepancies.filter(
        (discrepancy) => discrepancy.severity === "INFO",
      ).length,
      warnings: document.warnings,
    };
  }

  async getHistory(limit = 20): Promise<ReconciliationSnapshotHistoryEntry[]> {
    const snapshots = await this.prisma.reconciliationSnapshot.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        snapshotKey: true,
        epoch: true,
        capturedAt: true,
        validatorUniverseHash: true,
        stakeSnapshotHash: true,
        warningCount: true,
        discrepancyCount: true,
        epochSource: true,
        chainHeight: true,
        stakeSnapshotComplete: true,
        document: true,
      },
      orderBy: [{ epoch: "desc" }, { capturedAt: "desc" }],
    });

    return snapshots.map((snapshot) => ({
      snapshot_id: snapshot.id,
      snapshot_key: snapshot.snapshotKey,
      epoch: Number(snapshot.epoch),
      captured_at: snapshot.capturedAt.toISOString(),
      validator_universe_hash: snapshot.validatorUniverseHash,
      ...(snapshot.stakeSnapshotHash
        ? { stake_snapshot_hash: snapshot.stakeSnapshotHash }
        : {}),
      warning_count: snapshot.warningCount,
      discrepancy_count: snapshot.discrepancyCount,
      status: this.deriveSnapshotStatus(
        snapshot.document as unknown as LiveReconciliationDocument,
        {
          warningCount: snapshot.warningCount,
          discrepancyCount: snapshot.discrepancyCount,
          stakeSnapshotComplete: snapshot.stakeSnapshotComplete,
        },
      ),
      epoch_source: snapshot.epochSource,
      chain_height: Number(snapshot.chainHeight),
      stake_snapshot_complete: snapshot.stakeSnapshotComplete,
    }));
  }

  async getSnapshotByEpoch(
    epoch: number,
  ): Promise<HistoricalReconciliationSnapshot | null> {
    const snapshot = await this.prisma.reconciliationSnapshot.findFirst({
      where: {
        epoch: BigInt(epoch),
      },
      include: {
        discrepancies: true,
      },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    });

    if (!snapshot) {
      return null;
    }

    return {
      snapshot_id: snapshot.id,
      snapshot_key: snapshot.snapshotKey,
      status: this.deriveSnapshotStatus(
        snapshot.document as unknown as LiveReconciliationDocument,
        {
          warningCount: snapshot.warningCount,
          discrepancyCount: snapshot.discrepancyCount,
          stakeSnapshotComplete: snapshot.stakeSnapshotComplete,
        },
      ),
      created_at: snapshot.createdAt.toISOString(),
      document: snapshot.document as unknown as LiveReconciliationDocument,
      discrepancies: snapshot.discrepancies.map((discrepancy) => ({
        code: discrepancy.code,
        severity: discrepancy.severity,
        status: discrepancy.status as "ACTIVE",
        title: discrepancy.title,
        message: discrepancy.message,
        affected_accounts: discrepancy.affectedAccounts,
        ...(discrepancy.affectedShares
          ? { affected_shares: discrepancy.affectedShares }
          : {}),
        ...(typeof discrepancy.impactBps === "number"
          ? { impact_bps: discrepancy.impactBps }
          : {}),
        sample_addresses: discrepancy.sampleAddresses,
        ...(discrepancy.evidence
          ? {
              evidence: discrepancy.evidence as Record<string, unknown>,
            }
          : {}),
        ...(discrepancy.remediation
          ? { remediation: discrepancy.remediation }
          : {}),
      })),
    };
  }

  private async buildStakeSupply(
    warnings: string[],
    discrepancies: ReconciliationDiscrepancy[],
  ): Promise<LiveStakeSupplyBuildResult> {
    const cursorKey = getConfiguredIndexerCursorKey();
    const expectedNetwork = getConfiguredIndexerNetworkKeys();
    // The cursor marker and both stake projections must come from one MVCC
    // snapshot. Otherwise reconciliation can observe a newly committed share
    // transfer and an older VaultState while the indexer is between writes,
    // producing a false supply mismatch that survives a process crash.
    const generation = await this.prisma.$transaction(
      async (tx) => {
        const cursor = await tx.indexerCursor.findUnique({
          where: { cursorKey },
          select: {
            blockNumber: true,
            pendingBlockNumber: true,
            requiresRebuild: true,
            networkChainId: true,
            networkAnchorHash: true,
            networkVaultAddress: true,
            networkStaethelAddress: true,
            networkStablecoinBridgeAddress: true,
          },
        });

        const networkIdentityValid =
          !cursor ||
          expectedNetwork === null ||
          (cursor.networkChainId === expectedNetwork.identity.chainId &&
            cursor.networkAnchorHash?.toLowerCase() ===
              expectedNetwork.identity.anchorHash &&
            cursor.networkVaultAddress?.toLowerCase() ===
              expectedNetwork.identity.vaultAddress &&
            cursor.networkStaethelAddress?.toLowerCase() ===
              expectedNetwork.identity.staethelAddress &&
            cursor.networkStablecoinBridgeAddress?.toLowerCase() ===
              expectedNetwork.identity.stablecoinBridgeAddress);

        if (
          !cursor ||
          cursor.pendingBlockNumber !== null ||
          cursor.requiresRebuild ||
          !networkIdentityValid
        ) {
          return {
            cursor,
            networkIdentityValid,
            vaultState: null,
            stAethelBalances: [],
            legacyUnstakeCount: 0,
            legacyWithdrawalCount: 0,
            legacyRewardCount: 0,
          };
        }

        const [
          vaultState,
          stAethelBalances,
          legacyUnstakeCount,
          legacyWithdrawalCount,
          legacyRewardCount,
        ] = await Promise.all([
          tx.vaultState.findFirst({
            orderBy: {
              updatedAt: "desc",
            },
          }),
          tx.stAethelBalance.findMany({
            select: {
              holder: true,
              shares: true,
            },
          }),
          tx.vaultUnstake.count({
            where: { sourceProvenance: "LEGACY_UNVERIFIED" },
          }),
          tx.vaultWithdrawal.count({
            where: { sourceProvenance: "LEGACY_UNVERIFIED" },
          }),
          tx.vaultReward.count({
            where: { sourceProvenance: "LEGACY_UNVERIFIED" },
          }),
        ]);

        return {
          cursor,
          networkIdentityValid,
          vaultState,
          stAethelBalances,
          legacyUnstakeCount,
          legacyWithdrawalCount,
          legacyRewardCount,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    if (!generation.cursor) {
      this.pushDiscrepancy(discrepancies, warnings, {
        code: "INDEXER_GENERATION_UNAVAILABLE",
        severity: "CRITICAL",
        title: "Committed indexer generation is unavailable",
        message:
          "The EVM indexer cursor is missing, so vault share projections cannot be reconciled safely.",
        affected_accounts: 0,
        remediation:
          "Restore the durable evm-indexer cursor and complete canonical replay before capturing reconciliation evidence.",
      });
      return {};
    }

    if (!generation.networkIdentityValid) {
      this.pushDiscrepancy(discrepancies, warnings, {
        code: "INDEXER_GENERATION_IDENTITY_MISMATCH",
        severity: "CRITICAL",
        title: "Indexer generation source identity does not match",
        message:
          "The durable cursor is bound to a different network or indexed contract source, so its projections are withheld from reconciliation.",
        affected_accounts: 0,
        evidence: {
          committed_block: generation.cursor.blockNumber.toString(),
        },
        remediation:
          "Select the cursor namespace for the configured chain, anchor, vault, stAETHEL token, and stablecoin bridge, then replay canonically before capturing evidence.",
      });
      return {};
    }

    if (
      generation.cursor.pendingBlockNumber !== null ||
      generation.cursor.requiresRebuild
    ) {
      this.pushDiscrepancy(discrepancies, warnings, {
        code: "INDEXER_GENERATION_UNCOMMITTED",
        severity: "CRITICAL",
        title: "Indexer projection generation is incomplete",
        message:
          "The indexer is processing or rebuilding a projection generation, so holder shares and VaultState are intentionally withheld from reconciliation.",
        affected_accounts: 0,
        evidence: {
          committed_block: generation.cursor.blockNumber.toString(),
          pending_block:
            generation.cursor.pendingBlockNumber?.toString() ?? null,
          requires_rebuild: generation.cursor.requiresRebuild,
        },
        remediation:
          "Wait for the indexer to commit the pending block and clear its durable recovery marker before capturing reconciliation evidence.",
      });
      return {};
    }

    const {
      vaultState,
      stAethelBalances,
      legacyUnstakeCount,
      legacyWithdrawalCount,
      legacyRewardCount,
    } = generation;

    const legacyProjectionCount =
      legacyUnstakeCount + legacyWithdrawalCount + legacyRewardCount;
    if (legacyProjectionCount > 0) {
      this.pushDiscrepancy(discrepancies, warnings, {
        code: "LEGACY_VAULT_PROJECTION_UNVERIFIED",
        severity: "WARNING",
        title: "Legacy vault projections are not replay-verified",
        message:
          "Pre-upgrade unstake, withdrawal, or reward rows are retained for audit continuity but are explicitly excluded from replay-verification claims; exact legacy unstake deadlines are unavailable.",
        affected_accounts: 0,
        evidence: {
          legacy_unstake_rows: legacyUnstakeCount,
          legacy_withdrawal_rows: legacyWithdrawalCount,
          legacy_reward_rows: legacyRewardCount,
          exact_legacy_deadlines_available: false,
        },
        remediation:
          "Use canonical-event rows for exact deadline decisions and retain the legacy rows only as unverified historical evidence.",
      });
    }

    const activeHolderShares = new Map<string, bigint>();
    for (const entry of stAethelBalances) {
      const shares = BigInt(entry.shares);
      if (shares > 0n) {
        activeHolderShares.set(entry.holder, shares);
      }
    }

    const holderTotalShares = [...activeHolderShares.values()].reduce(
      (total, shares) => total + shares,
      0n,
    );
    const vaultTotalShares = vaultState?.totalShares;
    const matchesVaultTotal =
      vaultTotalShares === undefined
        ? null
        : holderTotalShares === BigInt(vaultTotalShares);

    if (
      vaultTotalShares !== undefined &&
      holderTotalShares !== BigInt(vaultTotalShares)
    ) {
      const vaultShares = BigInt(vaultTotalShares);
      const supplyDifference =
        holderTotalShares > vaultShares
          ? holderTotalShares - vaultShares
          : vaultShares - holderTotalShares;
      this.pushDiscrepancy(discrepancies, warnings, {
        code: "STAKE_SUPPLY_MISMATCH",
        severity: "CRITICAL",
        title: "Holder share supply does not match vault state",
        message: `Indexed holder shares (${holderTotalShares.toString()}) do not match indexed vault total shares (${vaultTotalShares}).`,
        affected_accounts: activeHolderShares.size,
        affected_shares: supplyDifference.toString(),
        impact_bps: this.calculateImpactBps(supplyDifference, vaultShares),
        evidence: {
          holder_total_shares: holderTotalShares.toString(),
          vault_total_shares: vaultTotalShares,
        },
        remediation:
          "Repair vault share materialization before treating this capture as complete.",
      });
    }

    if (vaultTotalShares === undefined) {
      this.pushDiscrepancy(discrepancies, warnings, {
        code: "VAULT_SHARE_SUPPLY_UNAVAILABLE",
        severity: "WARNING",
        title: "Vault share-supply comparison is unavailable",
        message:
          "The indexed VaultState totalShares value is unavailable, so holder share supply cannot be reconciled.",
        affected_accounts: activeHolderShares.size,
        affected_shares: holderTotalShares.toString(),
        remediation:
          "Restore the VaultState materialization before treating share-supply reconciliation as complete.",
      });
    }

    this.pushDiscrepancy(discrepancies, warnings, {
      code: "PER_HOLDER_VALIDATOR_ATTRIBUTION_UNAVAILABLE",
      severity: "WARNING",
      title: "Per-holder validator attribution is intentionally unavailable",
      message:
        "stAETHEL is transferable and validator allocation belongs to the pooled vault, so holders are not assigned a fabricated single validator target and no per-holder stake snapshot hash is published.",
      affected_accounts: activeHolderShares.size,
      affected_shares: holderTotalShares.toString(),
      evidence: {
        holder_total_shares: holderTotalShares.toString(),
        vault_total_shares: vaultTotalShares ?? null,
        attribution_model: "pooled-vault",
      },
      remediation:
        "Publish a protocol-defined vault allocation proof before enabling per-holder validator registry roots.",
    });

    return {
      stake_supply: {
        observed: {
          holder_total_shares: holderTotalShares.toString(),
          ...(vaultTotalShares !== undefined
            ? { vault_total_shares: vaultTotalShares }
            : {}),
        },
        meta: {
          holder_count: activeHolderShares.size,
          matches_vault_total: matchesVaultTotal,
        },
      },
    };
  }

  private async persistSnapshot(
    document: LiveReconciliationDocument,
  ): Promise<void> {
    const snapshotKey = this.buildSnapshotKey(document);

    await this.prisma.reconciliationSnapshot.upsert({
      where: {
        snapshotKey,
      },
      update: {},
      create: {
        snapshotKey,
        epoch: BigInt(document.epoch),
        network: document.network,
        mode: document.mode,
        capturedAt: new Date(document.captured_at),
        epochSource: document.source.epoch_source,
        chainHeight: BigInt(document.source.chain_height),
        validatorLimit: document.source.validator_limit,
        validatorCount: document.validator_selection.meta.validator_count,
        totalEligibleValidators:
          document.validator_selection.meta.total_eligible_validators,
        validatorUniverseHash:
          document.validator_selection.observed.universe_hash,
        ...(document.stake_snapshot?.observed?.stake_snapshot_hash
          ? {
              stakeSnapshotHash:
                document.stake_snapshot.observed.stake_snapshot_hash,
            }
          : {}),
        stakeSnapshotComplete: document.stake_snapshot?.meta?.complete ?? null,
        warningCount: document.warnings.length,
        discrepancyCount: document.discrepancies.length,
        warnings: document.warnings as unknown as Prisma.InputJsonValue,
        document: document as unknown as Prisma.InputJsonValue,
        discrepancies: {
          create: document.discrepancies.map((discrepancy) => ({
            code: discrepancy.code,
            severity: discrepancy.severity,
            status: discrepancy.status,
            title: discrepancy.title,
            message: discrepancy.message,
            affectedAccounts: discrepancy.affected_accounts,
            ...(discrepancy.affected_shares
              ? { affectedShares: discrepancy.affected_shares }
              : {}),
            ...(typeof discrepancy.impact_bps === "number"
              ? { impactBps: discrepancy.impact_bps }
              : {}),
            sampleAddresses: discrepancy.sample_addresses,
            ...(discrepancy.evidence
              ? {
                  evidence: discrepancy.evidence as Prisma.InputJsonValue,
                }
              : {}),
            ...(discrepancy.remediation
              ? { remediation: discrepancy.remediation }
              : {}),
          })),
        },
      },
    });
  }

  private buildSnapshotKey(document: LiveReconciliationDocument): string {
    const identity = JSON.stringify({
      epoch: document.epoch,
      chain_height: document.source.chain_height,
      validator_universe_hash:
        document.validator_selection.observed.universe_hash,
      stake_supply: document.stake_supply ?? null,
      legacy_stake_snapshot_hash:
        document.stake_snapshot?.observed?.stake_snapshot_hash ?? null,
      discrepancies: document.discrepancies.map((discrepancy) => ({
        code: discrepancy.code,
        severity: discrepancy.severity,
        affected_accounts: discrepancy.affected_accounts,
        affected_shares: discrepancy.affected_shares ?? null,
        impact_bps: discrepancy.impact_bps ?? null,
        evidence: discrepancy.evidence ?? null,
      })),
    });
    const digest = createHash("sha256").update(identity).digest("hex");
    return `v2:${document.epoch}:${digest}`;
  }

  private deriveSnapshotStatus(
    document: LiveReconciliationDocument,
    {
      warningCount,
      discrepancyCount,
      stakeSnapshotComplete,
    }: {
      warningCount: number;
      discrepancyCount: number;
      stakeSnapshotComplete: boolean | null;
    },
  ): "OK" | "WARNING" | "CRITICAL" {
    if (
      (document.discrepancies ?? []).some(
        (discrepancy) => discrepancy.severity === "CRITICAL",
      )
    ) {
      return "CRITICAL";
    }

    if (
      warningCount > 0 ||
      stakeSnapshotComplete === false ||
      discrepancyCount > 0
    ) {
      return "WARNING";
    }

    return "OK";
  }

  private pushDiscrepancy(
    discrepancies: ReconciliationDiscrepancy[],
    warnings: string[],
    payload: {
      code: string;
      severity: "INFO" | "WARNING" | "CRITICAL";
      title: string;
      message: string;
      affected_accounts?: number;
      affected_shares?: string;
      impact_bps?: number;
      sample_addresses?: string[];
      evidence?: Record<string, unknown>;
      remediation?: string;
    },
  ): void {
    discrepancies.push({
      code: payload.code,
      severity: payload.severity,
      status: "ACTIVE",
      title: payload.title,
      message: payload.message,
      affected_accounts: payload.affected_accounts ?? 0,
      ...(payload.affected_shares
        ? { affected_shares: payload.affected_shares }
        : {}),
      ...(typeof payload.impact_bps === "number"
        ? { impact_bps: payload.impact_bps }
        : {}),
      sample_addresses: payload.sample_addresses ?? [],
      ...(payload.evidence ? { evidence: payload.evidence } : {}),
      ...(payload.remediation ? { remediation: payload.remediation } : {}),
    });

    if (payload.severity !== "INFO") {
      warnings.push(payload.message);
    }
  }

  private calculateImpactBps(
    affectedShares: bigint,
    totalShares: bigint,
  ): number | undefined {
    if (affectedShares <= 0n || totalShares <= 0n) {
      return undefined;
    }

    return Number((affectedShares * 10_000n) / totalShares);
  }
}
