import { CCTP_DOMAINS } from "@/lib/constants";

export interface StablecoinBridgeLimitConfig {
  dailyTxLimit: bigint;
  mintCeilingPerEpoch: bigint;
}

export function isAllowedCctpDomain(destinationDomain: number): boolean {
  const allowedDomains: readonly number[] = Object.values(CCTP_DOMAINS);

  return (
    Number.isSafeInteger(destinationDomain) &&
    destinationDomain >= 0 &&
    allowedDomains.includes(destinationDomain)
  );
}

export function getStablecoinBridgeLimitBlockReason(
  amount: bigint,
  symbol: string,
  config: StablecoinBridgeLimitConfig,
): string | null {
  if (amount <= 0n) {
    return `Enter a ${symbol} amount greater than zero.`;
  }

  if (config.dailyTxLimit > 0n && amount > config.dailyTxLimit) {
    return `${symbol} amount exceeds the bridge's on-chain daily transaction limit.`;
  }

  if (config.mintCeilingPerEpoch > 0n && amount > config.mintCeilingPerEpoch) {
    return `${symbol} amount exceeds the bridge's on-chain mint ceiling for this epoch.`;
  }

  return null;
}
