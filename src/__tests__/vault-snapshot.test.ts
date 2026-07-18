import { describe, expect, it } from "vitest";
import { parseEther } from "viem";

import { buildLiveVaultSnapshot } from "@/lib/vaultSnapshot";

describe("live vault snapshot truth", () => {
  it("preserves valid zero TVL, APY, and epoch from a complete fresh deployment", () => {
    expect(
      buildLiveVaultSnapshot({
        totalPooledAethel: 0n,
        exchangeRate: parseEther("1"),
        effectiveAPY: 0n,
        currentEpoch: 0n,
        isAvailable: true,
      }),
    ).toEqual({
      tvl: 0,
      exchangeRate: 1,
      apy: 0,
      epoch: 0,
      hasAuthoritativeState: true,
    });
  });

  it("withholds placeholder zeroes when the aggregate contract query failed", () => {
    expect(
      buildLiveVaultSnapshot({
        totalPooledAethel: 0n,
        exchangeRate: 0n,
        effectiveAPY: 0n,
        currentEpoch: 0n,
        isAvailable: false,
      }),
    ).toEqual({
      tvl: null,
      exchangeRate: null,
      apy: null,
      epoch: null,
      hasAuthoritativeState: false,
    });
  });

  it("fails closed on an invalid zero exchange rate", () => {
    expect(
      buildLiveVaultSnapshot({
        totalPooledAethel: 0n,
        exchangeRate: 0n,
        effectiveAPY: 0n,
        currentEpoch: 0n,
        isAvailable: true,
      }).hasAuthoritativeState,
    ).toBe(false);
  });
});
