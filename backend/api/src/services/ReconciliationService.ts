import { Prisma, PrismaClient } from '@prisma/client';
import { injectable } from 'tsyringe';
import { BlockchainService } from './BlockchainService';
import {
  bytesToHex,
  computeCanonicalDelegationPayload,
  computeDelegationRegistryRoot,
  computeEligibleUniverseHash,
  computeStakeSnapshotHash,
  computeStakerRegistryRoot,
} from '../lib/protocolSdk';
import { resolveProtocolEpoch } from '../lib/protocolEpoch';

type ProtocolStaker = {
  address: string;
  shares: string;
  delegated_to: string;
};

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
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'ACTIVE';
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
  status: 'OK' | 'WARNING' | 'CRITICAL';
  epoch_source: string;
  chain_height: number;
  stake_snapshot_complete: boolean | null;
};

export type HistoricalReconciliationSnapshot = {
  snapshot_id: string;
  snapshot_key: string;
  status: 'OK' | 'WARNING' | 'CRITICAL';
  created_at: string;
  document: LiveReconciliationDocument;
  discrepancies: ReconciliationDiscrepancy[];
};

export type LiveReconciliationDocument = {
  epoch: number;
  network: string;
  mode: 'live-snapshot';
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
  stake_snapshot?: {
    input: {
      stakers: ProtocolStaker[];
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

type LiveStakeSnapshotBuildResult = {
  stake_snapshot?: LiveReconciliationDocument['stake_snapshot'];
};

@injectable()
export class ReconciliationService {
  private prisma: PrismaClient;

  constructor(private blockchainService: BlockchainService) {
    this.prisma = new PrismaClient();
  }

  private async getCurrentEpoch(
    warnings: string[],
    discrepancies: ReconciliationDiscrepancy[],
  ): Promise<{ epoch: number; source: string }> {
    const resolved = await resolveProtocolEpoch({
      blockchainService: this.blockchainService,
    });

    if (resolved.warning) {
      this.pushDiscrepancy(
        discrepancies,
        warnings,
        {
          code: 'EPOCH_FALLBACK',
          severity: 'WARNING',
          title: 'Authoritative epoch unavailable',
          message: resolved.warning,
          evidence: {
            epoch_source: resolved.source,
            epoch: resolved.epoch,
          },
          remediation:
            'Restore the canonical vault currentEpoch() source before treating this capture as fully canonical.',
        },
      );
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
      status: 'BOND_STATUS_BONDED',
    });
    const allEligibleAddresses = allValidators.data.map((validator) => validator.address);
    const universeHash = bytesToHex(computeEligibleUniverseHash(allEligibleAddresses));
    const presentedAddresses = allEligibleAddresses.slice(0, options.validatorLimit);
    const capturedAt = new Date().toISOString();

    if (presentedAddresses.length < allEligibleAddresses.length) {
      this.pushDiscrepancy(
        discrepancies,
        warnings,
        {
          code: 'VALIDATOR_VIEW_TRUNCATED',
          severity: 'INFO',
          title: 'Validator presentation truncated',
          message: `The public document is displaying the first ${presentedAddresses.length} validators while the canonical universe hash covers ${allEligibleAddresses.length} eligible validators.`,
          evidence: {
            displayed_validator_count: presentedAddresses.length,
            hashed_validator_count: allEligibleAddresses.length,
            validator_limit: options.validatorLimit,
          },
          remediation:
            'Use the immutable history or per-epoch retrieval endpoints to audit the canonical universe across time.',
        },
      );
    }

    const { stake_snapshot } = await this.buildStakeSnapshot(
      epoch,
      warnings,
      discrepancies,
    );

    const document: LiveReconciliationDocument = {
      epoch,
      network: 'aethelred',
      mode: 'live-snapshot',
      captured_at: capturedAt,
      source: {
        epoch_source: epochSource,
        validator_source: 'rpc/staking.validators',
        stake_source: 'indexer.stAethelBalance+delegation',
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
      validator_universe_hash: document.validator_selection.observed.universe_hash,
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
        (discrepancy) => discrepancy.severity === 'CRITICAL',
      ).length,
      warning_discrepancy_count: document.discrepancies.filter(
        (discrepancy) => discrepancy.severity === 'WARNING',
      ).length,
      info_discrepancy_count: document.discrepancies.filter(
        (discrepancy) => discrepancy.severity === 'INFO',
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
      orderBy: [{ epoch: 'desc' }, { capturedAt: 'desc' }],
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

  async getSnapshotByEpoch(epoch: number): Promise<HistoricalReconciliationSnapshot | null> {
    const snapshot = await this.prisma.reconciliationSnapshot.findFirst({
      where: {
        epoch: BigInt(epoch),
      },
      include: {
        discrepancies: true,
      },
      orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
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
        status: discrepancy.status as 'ACTIVE',
        title: discrepancy.title,
        message: discrepancy.message,
        affected_accounts: discrepancy.affectedAccounts,
        ...(discrepancy.affectedShares
          ? { affected_shares: discrepancy.affectedShares }
          : {}),
        ...(typeof discrepancy.impactBps === 'number'
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

  private async buildStakeSnapshot(
    epoch: number,
    warnings: string[],
    discrepancies: ReconciliationDiscrepancy[],
  ): Promise<LiveStakeSnapshotBuildResult> {
    const [vaultState, stAethelBalances, delegations] = await Promise.all([
      this.prisma.vaultState.findFirst({
        orderBy: {
          updatedAt: 'desc',
        },
      }),
      this.prisma.stAethelBalance.findMany({
        select: {
          holder: true,
          balance: true,
        },
      }),
      this.prisma.delegation.findMany({
        include: {
          delegator: {
            select: {
              address: true,
            },
          },
          validator: {
            select: {
              operatorAddress: true,
            },
          },
        },
      }),
    ]);

    const sharesByDelegator = new Map<string, bigint>();
    for (const entry of stAethelBalances) {
      const balance = BigInt(entry.balance);
      if (balance > 0n) {
        sharesByDelegator.set(entry.holder, balance);
      }
    }

    const activeStakers = [...sharesByDelegator.entries()]
      .filter(([, shares]) => shares > 0n)
      .sort(([left], [right]) => left.localeCompare(right));

    if (activeStakers.length === 0) {
      this.pushDiscrepancy(
        discrepancies,
        warnings,
        {
          code: 'NO_ACTIVE_STAKERS',
          severity: 'CRITICAL',
          title: 'No active vault stakers were found',
          message: 'No active vault stakers were found in the indexed state, so a live stake snapshot could not be built.',
          remediation:
            'Repair the balance indexer before using reconciliation artifacts for public verification.',
        },
      );
      return {};
    }

    const totalCandidateShares = activeStakers.reduce(
      (total, [, shares]) => total + shares,
      0n,
    );

    const activeDelegationsByDelegator = new Map<string, string[]>();
    for (const delegation of delegations) {
      if (BigInt(delegation.shares) <= 0n) {
        continue;
      }

      const delegatorAddress = delegation.delegator.address;
      const validatorAddress = delegation.validator.operatorAddress;
      const validatorList = activeDelegationsByDelegator.get(delegatorAddress) ?? [];
      validatorList.push(validatorAddress);
      activeDelegationsByDelegator.set(delegatorAddress, validatorList);
    }

    const skippedMissingDelegation: string[] = [];
    const skippedAmbiguousDelegation: string[] = [];
    let skippedMissingShares = 0n;
    let skippedAmbiguousShares = 0n;
    const stakers: ProtocolStaker[] = [];

    for (const [delegator, shares] of activeStakers) {
      const validatorsForDelegator = [
        ...new Set(activeDelegationsByDelegator.get(delegator) ?? []),
      ];

      if (validatorsForDelegator.length === 0) {
        skippedMissingDelegation.push(delegator);
        skippedMissingShares += shares;
        continue;
      }

      if (validatorsForDelegator.length > 1) {
        skippedAmbiguousDelegation.push(delegator);
        skippedAmbiguousShares += shares;
        continue;
      }

      stakers.push({
        address: delegator,
        shares: shares.toString(),
        delegated_to: validatorsForDelegator[0],
      });
    }

    if (skippedMissingDelegation.length > 0) {
      this.pushDiscrepancy(
        discrepancies,
        warnings,
        {
          code: 'MISSING_ACTIVE_DELEGATION',
          severity: 'WARNING',
          title: 'Stakers without an active delegation were excluded',
          message: `${skippedMissingDelegation.length} stakers were excluded because they do not currently map to any active delegation.`,
          affected_accounts: skippedMissingDelegation.length,
          affected_shares: skippedMissingShares.toString(),
          impact_bps: this.calculateImpactBps(skippedMissingShares, totalCandidateShares),
          sample_addresses: this.getAddressSample(skippedMissingDelegation),
          evidence: {
            total_candidate_stakers: activeStakers.length,
          },
          remediation:
            'Investigate whether delegation rows are missing from the indexer or whether these holders moved stAETHEL without a current delegation record.',
        },
      );
    }

    if (skippedAmbiguousDelegation.length > 0) {
      this.pushDiscrepancy(
        discrepancies,
        warnings,
        {
          code: 'AMBIGUOUS_ACTIVE_DELEGATION',
          severity: 'WARNING',
          title: 'Multi-target delegators were excluded',
          message: `${skippedAmbiguousDelegation.length} stakers were excluded because they map to more than one active delegation target.`,
          affected_accounts: skippedAmbiguousDelegation.length,
          affected_shares: skippedAmbiguousShares.toString(),
          impact_bps: this.calculateImpactBps(
            skippedAmbiguousShares,
            totalCandidateShares,
          ),
          sample_addresses: this.getAddressSample(skippedAmbiguousDelegation),
          evidence: {
            total_candidate_stakers: activeStakers.length,
          },
          remediation:
            'Expose per-validator stake attribution before treating this snapshot as complete.',
        },
      );
    }

    if (stakers.length === 0) {
      this.pushDiscrepancy(
        discrepancies,
        warnings,
        {
          code: 'NO_SINGLE_TARGET_STAKERS',
          severity: 'CRITICAL',
          title: 'No canonical staker snapshot could be produced',
          message:
            'A live stake snapshot could not be built because no active stakers had exactly one delegation target.',
          affected_accounts: activeStakers.length,
          affected_shares: totalCandidateShares.toString(),
          impact_bps: 10_000,
          remediation:
            'Repair stake attribution before publishing public reconciliation artifacts.',
        },
      );
      return {};
    }

    const stakeSnapshotHash = bytesToHex(computeStakeSnapshotHash(epoch, stakers));
    const includedTotalShares = stakers.reduce(
      (total, staker) => total + BigInt(staker.shares),
      0n,
    );

    let stakerRegistryRoot: string | undefined;
    let delegationRegistryRoot: string | undefined;
    let delegationPayloadHex: string | undefined;
    const registryRootsAvailable = stakers.every(
      (staker) =>
        this.isHexAddress20(staker.address) &&
        this.isHexAddress20(staker.delegated_to),
    );

    if (registryRootsAvailable) {
      stakerRegistryRoot = bytesToHex(computeStakerRegistryRoot(stakers));
      delegationRegistryRoot = bytesToHex(computeDelegationRegistryRoot(stakers));
      delegationPayloadHex = bytesToHex(
        computeCanonicalDelegationPayload({
          epoch,
          delegation_root: delegationRegistryRoot,
          staker_registry_root: stakerRegistryRoot,
        }),
      );
    } else {
      this.pushDiscrepancy(
        discrepancies,
        warnings,
        {
          code: 'NON_CANONICAL_LIVE_ADDRESSES',
          severity: 'WARNING',
          title: 'Registry roots were omitted',
          message:
            'Delegation and staker registry roots were omitted because one or more live addresses are not canonical 20-byte EVM hex values.',
          affected_accounts: stakers.filter(
            (staker) =>
              !this.isHexAddress20(staker.address) ||
              !this.isHexAddress20(staker.delegated_to),
          ).length,
          sample_addresses: this.getAddressSample(
            stakers
              .filter(
                (staker) =>
                  !this.isHexAddress20(staker.address) ||
                  !this.isHexAddress20(staker.delegated_to),
              )
              .map((staker) => staker.address),
          ),
          remediation:
            'Normalize public addresses into canonical 20-byte EVM hex form before treating registry roots as complete.',
        },
      );
    }

    const vaultTotalShares = vaultState?.totalShares;
    const complete =
      skippedMissingDelegation.length === 0 &&
      skippedAmbiguousDelegation.length === 0 &&
      (vaultTotalShares === undefined ||
        includedTotalShares === BigInt(vaultTotalShares));

    if (
      vaultTotalShares !== undefined &&
      includedTotalShares !== BigInt(vaultTotalShares)
    ) {
      this.pushDiscrepancy(
        discrepancies,
        warnings,
        {
          code: 'STAKE_SUPPLY_MISMATCH',
          severity: 'CRITICAL',
          title: 'Included share supply does not match vault state',
          message: `Included live stake snapshot shares (${includedTotalShares.toString()}) do not match indexed vault total shares (${vaultTotalShares}).`,
          affected_accounts: stakers.length,
          affected_shares: (BigInt(vaultTotalShares) - includedTotalShares).toString(),
          impact_bps: this.calculateImpactBps(
            includedTotalShares > BigInt(vaultTotalShares)
              ? includedTotalShares - BigInt(vaultTotalShares)
              : BigInt(vaultTotalShares) - includedTotalShares,
            BigInt(vaultTotalShares),
          ),
          evidence: {
            included_total_shares: includedTotalShares.toString(),
            vault_total_shares: vaultTotalShares,
          },
          remediation:
            'Repair vault share materialization before treating this capture as complete.',
        },
      );
    }

    return {
      stake_snapshot: {
        input: {
          stakers,
        },
        observed: {
          stake_snapshot_hash: stakeSnapshotHash,
          ...(stakerRegistryRoot ? { staker_registry_root: stakerRegistryRoot } : {}),
          ...(delegationRegistryRoot
            ? { delegation_registry_root: delegationRegistryRoot }
            : {}),
          ...(delegationPayloadHex
            ? { delegation_payload_hex: delegationPayloadHex }
            : {}),
        },
        meta: {
          total_candidate_stakers: activeStakers.length,
          included_stakers: stakers.length,
          skipped_stakers:
            skippedMissingDelegation.length + skippedAmbiguousDelegation.length,
          included_total_shares: includedTotalShares.toString(),
          ...(vaultTotalShares !== undefined
            ? { vault_total_shares: vaultTotalShares }
            : {}),
          registry_roots_available: registryRootsAvailable,
          complete,
        },
      },
    };
  }

  private async persistSnapshot(document: LiveReconciliationDocument): Promise<void> {
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
        validatorUniverseHash: document.validator_selection.observed.universe_hash,
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
            ...(typeof discrepancy.impact_bps === 'number'
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
    return [
      document.epoch,
      document.validator_selection.observed.universe_hash,
      document.stake_snapshot?.observed?.stake_snapshot_hash ?? 'no-stake-snapshot',
      document.warnings.length,
      document.discrepancies.length,
    ].join(':');
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
  ): 'OK' | 'WARNING' | 'CRITICAL' {
    if (
      (document.discrepancies ?? []).some(
        (discrepancy) => discrepancy.severity === 'CRITICAL',
      )
    ) {
      return 'CRITICAL';
    }

    if (
      warningCount > 0 ||
      stakeSnapshotComplete === false ||
      discrepancyCount > 0
    ) {
      return 'WARNING';
    }

    return 'OK';
  }

  private pushDiscrepancy(
    discrepancies: ReconciliationDiscrepancy[],
    warnings: string[],
    payload: {
      code: string;
      severity: 'INFO' | 'WARNING' | 'CRITICAL';
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
      status: 'ACTIVE',
      title: payload.title,
      message: payload.message,
      affected_accounts: payload.affected_accounts ?? 0,
      ...(payload.affected_shares ? { affected_shares: payload.affected_shares } : {}),
      ...(typeof payload.impact_bps === 'number'
        ? { impact_bps: payload.impact_bps }
        : {}),
      sample_addresses: payload.sample_addresses ?? [],
      ...(payload.evidence ? { evidence: payload.evidence } : {}),
      ...(payload.remediation ? { remediation: payload.remediation } : {}),
    });

    if (payload.severity !== 'INFO') {
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

  private getAddressSample(addresses: string[]): string[] {
    return addresses.slice(0, 5);
  }

  private isHexAddress20(value: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  }
}
