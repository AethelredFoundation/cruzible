export const VAULT_QUOTE_MAX_AGE_MS = 30_000;

export type VaultQuoteKind = "stake" | "unstake";

export interface VaultQuoteInput {
  kind: VaultQuoteKind;
  amount: number;
  exchangeRate: number | null;
  quoteUpdatedAt: number;
  nowMs?: number;
  maxAgeMs?: number;
}

export interface VaultQuoteSafety {
  expectedOutput: number | null;
  quoteAgeMs: number | null;
  expiresAt: number | null;
  hasLiveRate: boolean;
  isFresh: boolean;
  canSubmit: boolean;
  blockReason: string | null;
}

function isPositiveFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function buildVaultQuoteSafety({
  amount,
  exchangeRate,
  quoteUpdatedAt,
  nowMs = Date.now(),
  maxAgeMs = VAULT_QUOTE_MAX_AGE_MS,
}: VaultQuoteInput): VaultQuoteSafety {
  const hasValidAmount = isPositiveFiniteNumber(amount);
  const hasLiveRate = isPositiveFiniteNumber(exchangeRate);
  const hasQuoteTimestamp =
    Number.isFinite(quoteUpdatedAt) && quoteUpdatedAt > 0;
  const quoteAgeMs = hasQuoteTimestamp ? nowMs - quoteUpdatedAt : null;
  const isFresh =
    quoteAgeMs !== null && quoteAgeMs >= 0 && quoteAgeMs <= maxAgeMs;
  // stAETHEL is rebasing: its ERC-20 balance is already denominated in the
  // holder's current AETHEL claim. The exchange rate converts between that
  // token amount and invariant raw shares; applying it again here would
  // double-count the rebase.
  const expectedOutput = hasValidAmount && hasLiveRate ? amount : null;

  let blockReason: string | null = null;

  if (!hasValidAmount) {
    blockReason = "Enter an amount greater than zero.";
  } else if (!hasLiveRate) {
    blockReason =
      "Live vault exchange rate is unavailable. Wait for the contract quote before signing.";
  } else if (!hasQuoteTimestamp) {
    blockReason =
      "Vault quote timestamp is unavailable. Wait for a fresh contract read before signing.";
  } else if (!isFresh) {
    blockReason =
      "Vault quote expired. Wait for the exchange-rate quote to refresh before signing.";
  }

  return {
    expectedOutput,
    quoteAgeMs,
    expiresAt: hasQuoteTimestamp ? quoteUpdatedAt + maxAgeMs : null,
    hasLiveRate,
    isFresh,
    canSubmit: blockReason === null,
    blockReason,
  };
}

export function formatVaultQuoteAge(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) {
    return "not available";
  }

  if (ageMs < 1000) {
    return "just now";
  }

  return `${Math.floor(ageMs / 1000)}s ago`;
}
