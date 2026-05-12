import {
  buildVaultQuoteSafety,
  formatVaultQuoteAge,
  VAULT_QUOTE_MAX_AGE_MS,
} from "@/lib/vaultQuotes";

describe("vault quote safety", () => {
  it("builds a fresh stake quote from the live exchange rate", () => {
    const quote = buildVaultQuoteSafety({
      kind: "stake",
      amount: 10,
      exchangeRate: 2,
      quoteUpdatedAt: 1_000,
      nowMs: 2_000,
    });

    expect(quote.canSubmit).toBe(true);
    expect(quote.expectedOutput).toBe(5);
    expect(quote.quoteAgeMs).toBe(1_000);
    expect(quote.blockReason).toBeNull();
  });

  it("builds a fresh unstake quote from the live exchange rate", () => {
    const quote = buildVaultQuoteSafety({
      kind: "unstake",
      amount: 5,
      exchangeRate: 2,
      quoteUpdatedAt: 1_000,
      nowMs: 2_000,
    });

    expect(quote.canSubmit).toBe(true);
    expect(quote.expectedOutput).toBe(10);
  });

  it("fails closed when the live exchange rate is unavailable", () => {
    const quote = buildVaultQuoteSafety({
      kind: "stake",
      amount: 10,
      exchangeRate: null,
      quoteUpdatedAt: 1_000,
      nowMs: 2_000,
    });

    expect(quote.canSubmit).toBe(false);
    expect(quote.expectedOutput).toBeNull();
    expect(quote.blockReason).toContain("exchange rate is unavailable");
  });

  it("fails closed when the quote is stale", () => {
    const quote = buildVaultQuoteSafety({
      kind: "stake",
      amount: 10,
      exchangeRate: 2,
      quoteUpdatedAt: 1_000,
      nowMs: 1_000 + VAULT_QUOTE_MAX_AGE_MS + 1,
    });

    expect(quote.canSubmit).toBe(false);
    expect(quote.isFresh).toBe(false);
    expect(quote.blockReason).toContain("quote expired");
  });

  it("formats quote ages for safety copy", () => {
    expect(formatVaultQuoteAge(null)).toBe("not available");
    expect(formatVaultQuoteAge(500)).toBe("just now");
    expect(formatVaultQuoteAge(12_500)).toBe("12s ago");
  });
});
