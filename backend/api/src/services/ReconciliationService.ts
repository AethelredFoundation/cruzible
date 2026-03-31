import { injectable } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import { JsonRpcProvider, Contract } from 'ethers';
import { BlockchainService } from './BlockchainService';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  bytesToHex,
  computeCanonicalDelegationPayload,
  computeDelegationRegistryRoot,
  computeEligibleUniverseHash,
  computeStakeSnapshotHash,
  computeStakerRegistryRoot,
} from '../lib/protocolSdk';

type ProtocolStaker = {
  address: string;
  shares: string;
  delegated_to: string;
};

type LiveReconciliationOptions = {
  validatorLimit: number;
};

type LiveReconciliationDocument = {
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

@injectable()
export class ReconciliationService {
  private prisma: PrismaClient;

  constructor(private blockchainService: BlockchainService) {
    this.prisma = new PrismaClient();
  }

  /**
   * Query the Cruzible vault contract's `currentEpoch()` on the EVM.
   *
   * Falls back to the Tendermint latest block height when the vault address is
   * not configured, with a warning added to the output document.
   */
  private async getCurrentEpoch(warnings: string[]): Promise<{ epoch: number; source: string }> {
    const vaultAddress = config.cruzibleVaultAddress;
    if (!vaultAddress) {
      warnings.push(
        'CRUZIBLE_VAULT_ADDRESS is not configured; falling back to chain height as epoch (may produce incorrect hashes)'
      );
      const height = await this.blockchainService.getLatestHeight();
      return { epoch: height, source: 'rpc/tendermint.latestHeight (fallback)' };
    }

    try {
      const provider = new JsonRpcProvider(config.indexerRpcUrl);
      const vault = new Contract(
        vaultAddress,
        ['function currentEpoch() view returns (uint256)'],
        provider,
      );
      const raw: bigint = await vault.currentEpoch();
      return { epoch: Number(raw), source: 'evm/cruzible.currentEpoch' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to query currentEpoch from vault contract', { error: message });
      warnings.push(
        `Failed to query currentEpoch from vault contract (${message}); falling back to chain height`
      );
      const height = await this.blockchainService.getLatestHeight();
      return { epoch: height, source: 'rpc/tendermint.latestHeight (fallback)' };
    }
  }

  async getLiveDocument(
    options: LiveReconciliationOptions
  ): Promise<LiveReconciliationDocument> {
    const warnings: string[] = [];

    // ── Epoch: use the protocol's authoritative currentEpoch from the vault
    //    contract, NOT the Tendermint block height. ──
    const { epoch, source: epochSource } = await this.getCurrentEpoch(warnings);
    const chainHeight = await this.blockchainService.getLatestHeight();

    // ── Validators: fetch the FULL bonded set for canonical universe hashing,
    //    then truncate to `validatorLimit` for the presentation layer. ──
    const allValidators = await this.blockchainService.getValidators({
      limit: 10_000,  // effectively "all" — CosmJS returns the full set anyway
      offset: 0,
    });
    const allEligibleAddresses = allValidators.data.map((v) => v.address);
    const universeHash = bytesToHex(computeEligibleUniverseHash(allEligibleAddresses));

    // Truncate to the caller's requested limit for the response payload.
    const presentedAddresses = allEligibleAddresses.slice(0, options.validatorLimit);

    const stakeSnapshot = await this.buildStakeSnapshot(epoch, warnings);

    return {
      epoch,
      network: 'aethelred',
      mode: 'live-snapshot',
      captured_at: new Date().toISOString(),
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
      ...(stakeSnapshot ? { stake_snapshot: stakeSnapshot } : {}),
    };
  }

  private async buildStakeSnapshot(
    epoch: number,
    warnings: string[]
  ): Promise<LiveReconciliationDocument['stake_snapshot'] | undefined> {
    // Use StAethelBalance (current token holders) instead of re-deriving from
    // stake/unstake events.  stAETHEL is transferable, so the original staker
    // may no longer hold the shares.  The indexer maintains StAethelBalance by
    // processing Transfer events, giving us an accurate view of current
    // ownership.
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

    // Build share map from current token balances rather than stake/unstake
    // deltas.  This correctly reflects secondary stAETHEL transfers.
    const sharesByDelegator = new Map<string, bigint>();
    for (const entry of stAethelBalances) {
      const bal = BigInt(entry.balance);
      if (bal > 0n) {
        sharesByDelegator.set(entry.holder, bal);
      }
    }

    const activeStakers = [...sharesByDelegator.entries()]
      .filter(([, shares]) => shares > 0n)
      .sort(([left], [right]) => left.localeCompare(right));

    if (activeStakers.length === 0) {
      warnings.push('No active vault stakers were found in the indexed state');
      return undefined;
    }

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
    const stakers: ProtocolStaker[] = [];

    for (const [delegator, shares] of activeStakers) {
      const validatorsForDelegator = [
        ...new Set(activeDelegationsByDelegator.get(delegator) ?? []),
      ];

      if (validatorsForDelegator.length === 0) {
        skippedMissingDelegation.push(delegator);
        continue;
      }

      if (validatorsForDelegator.length > 1) {
        skippedAmbiguousDelegation.push(delegator);
        continue;
      }

      stakers.push({
        address: delegator,
        shares: shares.toString(),
        delegated_to: validatorsForDelegator[0],
      });
    }

    this.pushAddressWarning(
      warnings,
      skippedMissingDelegation,
      'Stakers without any active delegation were excluded from the live stake snapshot'
    );
    this.pushAddressWarning(
      warnings,
      skippedAmbiguousDelegation,
      'Stakers with multiple active delegations were excluded from the live stake snapshot'
    );

    if (stakers.length === 0) {
      warnings.push(
        'A live stake snapshot could not be built because no active stakers had a single delegation target'
      );
      return undefined;
    }

    const stakeSnapshotHash = bytesToHex(computeStakeSnapshotHash(epoch, stakers));
    const includedTotalShares = stakers.reduce(
      (total, staker) => total + BigInt(staker.shares),
      0n
    );

    let stakerRegistryRoot: string | undefined;
    let delegationRegistryRoot: string | undefined;
    let delegationPayloadHex: string | undefined;
    const registryRootsAvailable = stakers.every(
      (staker) => this.isHexAddress20(staker.address) && this.isHexAddress20(staker.delegated_to)
    );

    if (registryRootsAvailable) {
      stakerRegistryRoot = bytesToHex(computeStakerRegistryRoot(stakers));
      delegationRegistryRoot = bytesToHex(computeDelegationRegistryRoot(stakers));
      delegationPayloadHex = bytesToHex(
        computeCanonicalDelegationPayload({
          epoch,
          delegation_root: delegationRegistryRoot,
          staker_registry_root: stakerRegistryRoot,
        })
      );
    } else {
      warnings.push(
        'Delegation and staker registry roots were omitted because one or more live addresses are not canonical 20-byte EVM hex values'
      );
    }

    const vaultTotalShares = vaultState?.totalShares;
    const complete =
      skippedMissingDelegation.length === 0 &&
      skippedAmbiguousDelegation.length === 0 &&
      (vaultTotalShares === undefined || includedTotalShares === BigInt(vaultTotalShares));

    if (vaultTotalShares !== undefined && includedTotalShares !== BigInt(vaultTotalShares)) {
      warnings.push(
        `Included live stake snapshot shares (${includedTotalShares.toString()}) do not match indexed vault total shares (${vaultTotalShares})`
      );
    }

    return {
      input: {
        stakers,
      },
      observed: {
        stake_snapshot_hash: stakeSnapshotHash,
        ...(stakerRegistryRoot ? { staker_registry_root: stakerRegistryRoot } : {}),
        ...(delegationRegistryRoot
          ? { delegation_registry_root: delegationRegistryRoot }
          : {}),
        ...(delegationPayloadHex ? { delegation_payload_hex: delegationPayloadHex } : {}),
      },
      meta: {
        total_candidate_stakers: activeStakers.length,
        included_stakers: stakers.length,
        skipped_stakers:
          skippedMissingDelegation.length + skippedAmbiguousDelegation.length,
        included_total_shares: includedTotalShares.toString(),
        ...(vaultTotalShares !== undefined ? { vault_total_shares: vaultTotalShares } : {}),
        registry_roots_available: registryRootsAvailable,
        complete,
      },
    };
  }

  private pushAddressWarning(
    warnings: string[],
    addresses: string[],
    prefix: string
  ): void {
    if (addresses.length === 0) {
      return;
    }

    const sample = addresses.slice(0, 3).join(', ');
    const suffix = addresses.length > 3 ? `, +${addresses.length - 3} more` : '';
    warnings.push(`${prefix}: ${sample}${suffix}`);
  }

  private isHexAddress20(value: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(value);
  }
}
