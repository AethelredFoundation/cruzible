import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { toDisplayWithdrawalRequests } from "@/lib/withdrawalRequests";
import type { WithdrawalRequest } from "@/hooks/useVault";

function withdrawal(overrides: Partial<WithdrawalRequest>): WithdrawalRequest {
  return {
    id: 0n,
    shares: parseEther("1"),
    aethelAmount: parseEther("1"),
    requestTime: 1_700_000_000n,
    completionTime: 1_700_086_400n,
    claimed: false,
    ...overrides,
  };
}

describe("toDisplayWithdrawalRequests", () => {
  it("preserves exact bigint IDs for ready withdrawal claims", () => {
    const largeId = 9_007_199_254_740_993n;
    const requests = toDisplayWithdrawalRequests(
      [
        withdrawal({ id: 0n, completionTime: 1_700_000_000n }),
        withdrawal({ id: 7n, completionTime: 1_700_000_000n }),
        withdrawal({ id: largeId, completionTime: 1_700_000_000n }),
      ],
      1_700_000_001,
    );

    expect(requests.map((request) => request.id)).toEqual([
      "w0",
      "w7",
      `w${largeId.toString()}`,
    ]);
    expect(requests.map((request) => request.withdrawalId)).toEqual([
      0n,
      7n,
      largeId,
    ]);
    expect(requests.every((request) => request.status === "ready")).toBe(true);
  });

  it("separates pending, ready, and claimed withdrawal states", () => {
    const [pending, ready, claimed] = toDisplayWithdrawalRequests(
      [
        withdrawal({ id: 1n, completionTime: 1_700_172_800n }),
        withdrawal({ id: 2n, completionTime: 1_700_000_000n }),
        withdrawal({ id: 3n, completionTime: 1_700_000_000n, claimed: true }),
      ],
      1_700_000_001,
    );

    expect(pending).toMatchObject({
      id: "w1",
      withdrawalId: 1n,
      status: "pending",
      daysRemaining: 2,
    });
    expect(ready).toMatchObject({
      id: "w2",
      withdrawalId: 2n,
      status: "ready",
      daysRemaining: 0,
    });
    expect(claimed).toMatchObject({
      id: "w3",
      withdrawalId: 3n,
      status: "claimed",
      daysRemaining: 0,
    });
  });
});
