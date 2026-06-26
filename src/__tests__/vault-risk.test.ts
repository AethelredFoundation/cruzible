import {
  buildVaultRiskSignals,
  buildWithdrawalLiquiditySummary,
} from "@/lib/vaultRisk";

describe("vault risk intelligence", () => {
  it("marks incomplete live vault and control-plane evidence as warning or blocked", () => {
    const signals = buildVaultRiskSignals({
      hasAuthoritativeState: false,
      controlPlaneAvailable: true,
      controlPlaneWarningCount: 2,
      epochSource: "fallback_rpc",
      stakeSnapshotComplete: false,
    });

    expect(
      signals.find((signal) => signal.id === "vault-telemetry"),
    ).toMatchObject({
      status: "Gated",
      tone: "warning",
    });
    expect(
      signals.find((signal) => signal.id === "control-plane"),
    ).toMatchObject({
      status: "2 warnings",
      tone: "warning",
    });
    expect(
      signals.find((signal) => signal.id === "stake-snapshot"),
    ).toMatchObject({
      status: "Partial",
      tone: "blocked",
    });
  });

  it("keeps quote, withdrawal, and proof guardrails visible even when data is healthy", () => {
    const signals = buildVaultRiskSignals({
      hasAuthoritativeState: true,
      controlPlaneAvailable: true,
      controlPlaneWarningCount: 0,
      epochSource: "indexer",
      stakeSnapshotComplete: true,
    });

    expect(signals.map((signal) => signal.id)).toEqual([
      "vault-telemetry",
      "control-plane",
      "stake-snapshot",
      "quote-guard",
      "withdrawal-liquidity",
      "reward-proof",
    ]);
    expect(
      signals.find((signal) => signal.id === "control-plane"),
    ).toMatchObject({
      status: "No warnings",
      tone: "healthy",
    });
    expect(
      signals.find((signal) => signal.id === "withdrawal-liquidity"),
    ).toMatchObject({
      status: "Cooldown enforced",
      tone: "warning",
    });
  });

  it("summarizes withdrawal liquidity without promising instant exits", () => {
    const summary = buildWithdrawalLiquiditySummary({
      requestCount: 3,
      pendingCount: 1,
      readyCount: 1,
      claimedCount: 1,
      hasLiveExchangeRate: false,
    });

    expect(summary.find((signal) => signal.id === "live-queue")).toMatchObject({
      status: "3 requests",
      detail: "1 pending, 1 ready, 1 claimed.",
    });
    expect(
      summary.find((signal) => signal.id === "quote-status"),
    ).toMatchObject({
      status: "Rate unavailable",
      tone: "warning",
    });
    expect(
      summary.find((signal) => signal.id === "instant-exit"),
    ).toMatchObject({
      status: "Not guaranteed",
      tone: "blocked",
    });
  });
});
