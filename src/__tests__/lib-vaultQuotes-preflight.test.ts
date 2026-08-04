import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  buildVaultQuoteSafety,
  formatVaultQuoteAge,
  VAULT_QUOTE_MAX_AGE_MS,
} from "@/lib/vaultQuotes";
import {
  getTransactionFailureMessage,
  getPreflightFailureMessage,
  isWalletRejectionError,
} from "@/lib/transactionPreflight";

describe("vaultQuotes buildVaultQuoteSafety", () => {
  const now = 1_000_000;
  const base = {
    kind: "stake" as const,
    amount: 100,
    exchangeRate: 2,
    quoteUpdatedAt: now,
    nowMs: now,
  };

  it("keeps stake output in rebasing token units without applying the raw-share rate twice", () => {
    expect(buildVaultQuoteSafety(base).expectedOutput).toBe(100);
  });

  it("keeps unstake output in AETHEL-denominated rebasing token units", () => {
    expect(
      buildVaultQuoteSafety({ ...base, kind: "unstake" }).expectedOutput,
    ).toBe(100);
  });

  it("permits submission with a fresh live quote", () => {
    const s = buildVaultQuoteSafety(base);
    expect(s.canSubmit).toBe(true);
    expect(s.blockReason).toBeNull();
    expect(s.isFresh).toBe(true);
    expect(s.hasLiveRate).toBe(true);
  });

  it.each([
    [0, "Enter an amount greater than zero."],
    [-5, "Enter an amount greater than zero."],
    [Number.NaN, "Enter an amount greater than zero."],
  ])("blocks invalid amount %s", (amount, reason) => {
    const s = buildVaultQuoteSafety({ ...base, amount });
    expect(s.canSubmit).toBe(false);
    expect(s.blockReason).toBe(reason);
    expect(s.expectedOutput).toBeNull();
  });

  it.each([null, 0, -1, Number.NaN])(
    "blocks when exchange rate is %s",
    (rate) => {
      const s = buildVaultQuoteSafety({
        ...base,
        exchangeRate: rate as number | null,
      });
      expect(s.canSubmit).toBe(false);
      expect(s.hasLiveRate).toBe(false);
      expect(s.blockReason).toContain("exchange rate is unavailable");
    },
  );

  it("blocks when the quote timestamp is missing", () => {
    const s = buildVaultQuoteSafety({ ...base, quoteUpdatedAt: 0 });
    expect(s.canSubmit).toBe(false);
    expect(s.blockReason).toContain("timestamp is unavailable");
    expect(s.quoteAgeMs).toBeNull();
  });

  it("blocks a stale quote past max age", () => {
    const s = buildVaultQuoteSafety({
      ...base,
      quoteUpdatedAt: now - VAULT_QUOTE_MAX_AGE_MS - 1,
    });
    expect(s.isFresh).toBe(false);
    expect(s.canSubmit).toBe(false);
    expect(s.blockReason).toContain("expired");
  });

  it("treats a quote exactly at max age as fresh", () => {
    const s = buildVaultQuoteSafety({
      ...base,
      quoteUpdatedAt: now - VAULT_QUOTE_MAX_AGE_MS,
    });
    expect(s.isFresh).toBe(true);
    expect(s.canSubmit).toBe(true);
  });

  it("blocks a future-dated quote (negative age)", () => {
    const s = buildVaultQuoteSafety({ ...base, quoteUpdatedAt: now + 5000 });
    expect(s.isFresh).toBe(false);
    expect(s.canSubmit).toBe(false);
  });

  it("computes expiresAt from the quote timestamp and max age", () => {
    const s = buildVaultQuoteSafety(base);
    expect(s.expiresAt).toBe(now + VAULT_QUOTE_MAX_AGE_MS);
  });

  it("honors a custom maxAgeMs", () => {
    const s = buildVaultQuoteSafety({
      ...base,
      quoteUpdatedAt: now - 5000,
      maxAgeMs: 1000,
    });
    expect(s.isFresh).toBe(false);
  });
});

describe("vaultQuotes formatVaultQuoteAge", () => {
  it.each([
    [null, "not available"],
    [Number.NaN, "not available"],
    [-1, "not available"],
    [0, "just now"],
    [999, "just now"],
    [1000, "1s ago"],
    [1500, "1s ago"],
    [5000, "5s ago"],
    [61000, "61s ago"],
  ])("formatVaultQuoteAge(%s) === %s", (ageMs, expected) => {
    expect(formatVaultQuoteAge(ageMs as number | null)).toBe(expected);
  });
});

describe("transactionPreflight message helpers", () => {
  it("getTransactionFailureMessage passes through the public error message", () => {
    expect(getTransactionFailureMessage("boom")).toBe("boom");
    expect(getTransactionFailureMessage(null)).toBe("Unknown error");
    expect(getTransactionFailureMessage(null, "custom")).toBe("custom");
  });

  it("getPreflightFailureMessage uses the simulation-specific fallback", () => {
    expect(getPreflightFailureMessage(null)).toBe(
      "The contract simulation failed before wallet signing.",
    );
    expect(getPreflightFailureMessage({ shortMessage: "reverted: X" })).toBe(
      "reverted: X",
    );
    expect(
      getPreflightFailureMessage({
        shortMessage: "Execution reverted for an unknown reason.",
      }),
    ).toBe(
      "The configured Cruzible vault rejected this call without a decodable error. Verify that NEXT_PUBLIC_CRUZIBLE_ADDRESS points to the replacement deployment for this release, then rebuild the frontend.",
    );
  });
});

describe("transactionPreflight isWalletRejectionError", () => {
  it.each([
    [{ name: "UserRejectedRequestError" }, true],
    [{ code: 4001 }, true],
    [{ message: "User rejected the request" }, true],
    [{ shortMessage: "Transaction rejected" }, true],
    [{ message: "denied by user" }, true],
    [{ message: "User denied transaction signature" }, true],
    [{ message: "rejected the request." }, true],
    [{ message: "insufficient funds" }, false],
    [{ code: 500 }, false],
    [{ name: "SomeOtherError" }, false],
    [{}, false],
    [null, false],
    ["string error", false],
    [42, false],
  ])("isWalletRejectionError(%o) === %s", (error, expected) => {
    expect(isWalletRejectionError(error)).toBe(expected);
  });

  it("matches rejection phrases case-insensitively", () => {
    expect(isWalletRejectionError({ message: "USER REJECTED" })).toBe(true);
    expect(isWalletRejectionError({ shortMessage: "Denied By User" })).toBe(
      true,
    );
  });

  it("prefers shortMessage over message for phrase matching", () => {
    expect(
      isWalletRejectionError({ shortMessage: "user rejected", message: "ok" }),
    ).toBe(true);
  });
});
