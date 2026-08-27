import { formatEther } from "viem";

export interface VaultSnapshotSource {
  totalPooledAethel: bigint;
  exchangeRate: bigint;
  currentEpoch: bigint;
  effectiveAPY: bigint;
  isAvailable: boolean;
}

export interface LiveVaultSnapshot {
  tvl: number | null;
  exchangeRate: number | null;
  apy: number | null;
  epoch: number | null;
  hasAuthoritativeState: boolean;
}

/**
 * Convert a complete vault read into display units without conflating a valid
 * on-chain zero with an unavailable query. The exchange rate is the one value
 * that must remain positive for stake/share conversions to be meaningful.
 */
export function buildLiveVaultSnapshot(
  source: VaultSnapshotSource,
): LiveVaultSnapshot {
  if (!source.isAvailable) {
    return {
      tvl: null,
      exchangeRate: null,
      apy: null,
      epoch: null,
      hasAuthoritativeState: false,
    };
  }

  const tvl = Number(formatEther(source.totalPooledAethel));
  const exchangeRate =
    source.exchangeRate > 0n ? Number(formatEther(source.exchangeRate)) : null;
  const apy = Number(source.effectiveAPY) / 100;
  const epoch = Number(source.currentEpoch);

  return {
    tvl,
    exchangeRate,
    apy,
    epoch,
    hasAuthoritativeState:
      Number.isFinite(tvl) &&
      exchangeRate !== null &&
      Number.isFinite(exchangeRate) &&
      Number.isFinite(apy) &&
      Number.isSafeInteger(epoch),
  };
}
