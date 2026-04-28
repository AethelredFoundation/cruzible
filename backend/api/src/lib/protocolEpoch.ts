import { Contract, JsonRpcProvider } from 'ethers';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { BlockchainService } from '../services/BlockchainService';

export type ProtocolEpochResolution = {
  epoch: number;
  source: string;
  warning?: string;
};

type ResolveProtocolEpochOptions = {
  blockchainService: Pick<BlockchainService, 'getLatestHeight'>;
  latestHeight?: number;
};

async function getFallbackHeight(
  options: ResolveProtocolEpochOptions,
): Promise<number> {
  if (typeof options.latestHeight === 'number' && Number.isFinite(options.latestHeight)) {
    return options.latestHeight;
  }

  return options.blockchainService.getLatestHeight();
}

export async function resolveProtocolEpoch(
  options: ResolveProtocolEpochOptions,
): Promise<ProtocolEpochResolution> {
  const vaultAddress = config.cruzibleVaultAddress;

  if (!vaultAddress) {
    const height = await getFallbackHeight(options);
    return {
      epoch: height,
      source: 'rpc/tendermint.latestHeight (fallback)',
      warning:
        'CRUZIBLE_VAULT_ADDRESS is not configured; falling back to chain height as epoch',
    };
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
    const height = await getFallbackHeight(options);
    return {
      epoch: height,
      source: 'rpc/tendermint.latestHeight (fallback)',
      warning: `Failed to query currentEpoch from vault contract (${message}); falling back to chain height`,
    };
  }
}
