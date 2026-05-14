import { Contract, JsonRpcProvider } from 'ethers';
import { config } from '../config';
import { logger } from '../utils/logger';
import { errorContext } from '../utils/errorContext';
import type { BlockchainService } from '../services/BlockchainService';

export type ProtocolEpochResolution = {
  epoch: number;
  source: string;
  warning?: string;
};

const CURRENT_EPOCH_FALLBACK_WARNING =
  'Failed to query currentEpoch from vault contract; falling back to chain height';

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
    logger.error(
      'Failed to query currentEpoch from vault contract',
      errorContext(err),
    );
    const height = await getFallbackHeight(options);
    return {
      epoch: height,
      source: 'rpc/tendermint.latestHeight (fallback)',
      warning: CURRENT_EPOCH_FALLBACK_WARNING,
    };
  }
}
