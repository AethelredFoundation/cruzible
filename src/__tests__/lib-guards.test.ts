import { describe, it, expect } from "vitest";

import {
  isAllowedCctpDomain,
  getStablecoinBridgeLimitBlockReason,
  type StablecoinBridgeLimitConfig,
} from "@/lib/stablecoinBridgeGuards";
import {
  canSubmitStakeForm,
  canSubmitUnstakeForm,
} from "@/lib/vaultFormGuards";
import { toDisplayWithdrawalRequests } from "@/lib/withdrawalRequests";
import type { WithdrawalRequest } from "@/hooks/useVault";

describe("stablecoinBridgeGuards isAllowedCctpDomain", () => {
  it.each([0, 1, 2, 3, 6, 7])("allows canonical CCTP domain %d", (d) => {
    expect(isAllowedCctpDomain(d)).toBe(true);
  });

  it.each([4, 5, 8, 99, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "blocks non-canonical / invalid domain %s",
    (d) => {
      expect(isAllowedCctpDomain(d as number)).toBe(false);
    },
  );
});

describe("stablecoinBridgeGuards getStablecoinBridgeLimitBlockReason", () => {
  const config: StablecoinBridgeLimitConfig = {
    dailyTxLimit: 1000n,
    mintCeilingPerEpoch: 5000n,
  };

  it("blocks a zero or negative amount", () => {
    expect(getStablecoinBridgeLimitBlockReason(0n, "USDC", config)).toBe(
      "Enter a USDC amount greater than zero.",
    );
    expect(getStablecoinBridgeLimitBlockReason(-5n, "USDC", config)).toContain(
      "greater than zero",
    );
  });

  it("blocks an amount over the daily tx limit", () => {
    expect(
      getStablecoinBridgeLimitBlockReason(1001n, "USDC", config),
    ).toContain("daily transaction limit");
  });

  it("blocks an amount over the epoch mint ceiling", () => {
    const noDaily: StablecoinBridgeLimitConfig = {
      dailyTxLimit: 0n,
      mintCeilingPerEpoch: 5000n,
    };
    expect(
      getStablecoinBridgeLimitBlockReason(5001n, "USDT", noDaily),
    ).toContain("mint ceiling");
  });

  it("allows an amount within both limits", () => {
    expect(
      getStablecoinBridgeLimitBlockReason(500n, "USDC", config),
    ).toBeNull();
  });

  it("treats a zero limit as unlimited", () => {
    const unlimited: StablecoinBridgeLimitConfig = {
      dailyTxLimit: 0n,
      mintCeilingPerEpoch: 0n,
    };
    expect(
      getStablecoinBridgeLimitBlockReason(10n ** 30n, "USDC", unlimited),
    ).toBeNull();
  });

  it("checks the daily limit before the mint ceiling", () => {
    // amount over BOTH -> daily message wins (checked first)
    expect(
      getStablecoinBridgeLimitBlockReason(9999n, "USDC", config),
    ).toContain("daily transaction limit");
  });
});

describe("vaultFormGuards canSubmitStakeForm", () => {
  const ok = {
    walletConnected: true,
    isWrongNetwork: false,
    amountWei: 100n,
    balanceWei: 1000n,
    quoteCanSubmit: true,
    minStakeWei: 10n,
  };

  it("permits a fully valid stake", () => {
    expect(canSubmitStakeForm(ok)).toBe(true);
  });

  it.each([
    ["wallet disconnected", { walletConnected: false }],
    ["wrong network", { isWrongNetwork: true }],
    ["null amount", { amountWei: null }],
    ["below min stake", { amountWei: 5n }],
    ["above balance", { amountWei: 2000n }],
    ["quote not submittable", { quoteCanSubmit: false }],
  ])("blocks when %s", (_label, override) => {
    expect(canSubmitStakeForm({ ...ok, ...override })).toBe(false);
  });

  it("permits exactly at min stake and exactly at balance", () => {
    expect(canSubmitStakeForm({ ...ok, amountWei: 10n })).toBe(true);
    expect(canSubmitStakeForm({ ...ok, amountWei: 1000n })).toBe(true);
  });
});

describe("vaultFormGuards canSubmitUnstakeForm", () => {
  const ok = {
    walletConnected: true,
    isWrongNetwork: false,
    amountWei: 100n,
    balanceWei: 1000n,
    quoteCanSubmit: true,
  };

  it("permits a fully valid unstake", () => {
    expect(canSubmitUnstakeForm(ok)).toBe(true);
  });

  it.each([
    ["wallet disconnected", { walletConnected: false }],
    ["wrong network", { isWrongNetwork: true }],
    ["null amount", { amountWei: null }],
    ["above balance", { amountWei: 2000n }],
    ["quote not submittable", { quoteCanSubmit: false }],
  ])("blocks when %s", (_label, override) => {
    expect(canSubmitUnstakeForm({ ...ok, ...override })).toBe(false);
  });

  it("has no minimum (permits a 1-wei unstake)", () => {
    expect(canSubmitUnstakeForm({ ...ok, amountWei: 1n })).toBe(true);
  });
});

describe("withdrawalRequests toDisplayWithdrawalRequests", () => {
  const DAY = 86400;
  function req(overrides: Partial<WithdrawalRequest> = {}): WithdrawalRequest {
    return {
      id: 1n,
      shares: 1_000000000000000000n,
      aethelAmount: 2_000000000000000000n,
      requestTime: 1_000_000n,
      completionTime: BigInt(1_000_000 + 21 * DAY),
      claimed: false,
      ...overrides,
    };
  }

  it("maps the immutable AETHEL snapshot into both display amounts", () => {
    const [d] = toDisplayWithdrawalRequests([req()], 1_000_000);
    expect(d.amount).toBe(2);
    expect(d.stAethelAmount).toBe(2);
    expect(d.id).toBe("w1");
    expect(d.withdrawalId).toBe(1n);
  });

  it("marks a claimed request as claimed regardless of time", () => {
    const [d] = toDisplayWithdrawalRequests(
      [req({ claimed: true })],
      1_000_000,
    );
    expect(d.status).toBe("claimed");
  });

  it("marks a request ready when the cooldown has elapsed", () => {
    const now = 1_000_000 + 21 * DAY;
    const [d] = toDisplayWithdrawalRequests([req()], now);
    expect(d.status).toBe("ready");
    expect(d.daysRemaining).toBe(0);
  });

  it("marks a request pending mid-cooldown with days remaining", () => {
    const now = 1_000_000 + 5 * DAY;
    const [d] = toDisplayWithdrawalRequests([req()], now);
    expect(d.status).toBe("pending");
    expect(d.daysRemaining).toBe(16);
  });

  it("floors daysRemaining at zero when now is past completion", () => {
    const now = 1_000_000 + 100 * DAY;
    const [d] = toDisplayWithdrawalRequests([req()], now);
    expect(d.daysRemaining).toBe(0);
  });

  it("clamps totalDays to at least 1", () => {
    const [d] = toDisplayWithdrawalRequests(
      [req({ requestTime: 1_000_000n, completionTime: 1_000_000n })],
      1_000_000,
    );
    expect(d.totalDays).toBe(1);
  });

  it("maps an empty list to an empty list", () => {
    expect(toDisplayWithdrawalRequests([], 0)).toEqual([]);
  });

  it("preserves order across multiple requests", () => {
    const out = toDisplayWithdrawalRequests(
      [req({ id: 1n }), req({ id: 2n }), req({ id: 3n })],
      1_000_000,
    );
    expect(out.map((d) => d.withdrawalId)).toEqual([1n, 2n, 3n]);
  });
});
