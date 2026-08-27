import { describe, expect, it } from "vitest";
import {
  getStablecoinBridgeLimitBlockReason,
  isAllowedCctpDomain,
} from "@/lib/stablecoinBridgeGuards";

describe("stablecoin bridge guards", () => {
  it("only allows configured CCTP destination domains", () => {
    expect(isAllowedCctpDomain(0)).toBe(true);
    expect(isAllowedCctpDomain(3)).toBe(true);
    expect(isAllowedCctpDomain(-1)).toBe(false);
    expect(isAllowedCctpDomain(1.5)).toBe(false);
    expect(isAllowedCctpDomain(99_999)).toBe(false);
  });

  it("fails closed for zero amounts and on-chain bridge limits", () => {
    expect(
      getStablecoinBridgeLimitBlockReason(0n, "USDC", {
        dailyTxLimit: 1_000n,
        mintCeilingPerEpoch: 1_000n,
      }),
    ).toContain("greater than zero");

    expect(
      getStablecoinBridgeLimitBlockReason(1_001n, "USDC", {
        dailyTxLimit: 1_000n,
        mintCeilingPerEpoch: 2_000n,
      }),
    ).toContain("daily transaction limit");

    expect(
      getStablecoinBridgeLimitBlockReason(1_501n, "USDC", {
        dailyTxLimit: 0n,
        mintCeilingPerEpoch: 1_500n,
      }),
    ).toContain("mint ceiling");
  });

  it("permits positive amounts inside live on-chain limits", () => {
    expect(
      getStablecoinBridgeLimitBlockReason(999n, "USDC", {
        dailyTxLimit: 1_000n,
        mintCeilingPerEpoch: 2_000n,
      }),
    ).toBeNull();
  });
});
