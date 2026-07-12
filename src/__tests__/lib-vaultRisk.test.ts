import { describe, it, expect } from "vitest";

import {
  buildVaultRiskSignals,
  buildWithdrawalLiquiditySummary,
  VAULT_RISK_DISCLOSURES,
  WITHDRAWAL_LIQUIDITY_CHECKPOINTS,
  type VaultRiskInput,
  type WithdrawalLiquidityInput,
} from "@/lib/vaultRisk";

const baseInput: VaultRiskInput = {
  hasAuthoritativeState: true,
  controlPlaneAvailable: true,
  controlPlaneWarningCount: 0,
  epochSource: "live",
  stakeSnapshotComplete: true,
};

function signal(input: VaultRiskInput, id: string) {
  return buildVaultRiskSignals(input).find((s) => s.id === id)!;
}

describe("vaultRisk buildVaultRiskSignals", () => {
  it("returns the six fixed signal ids", () => {
    const ids = buildVaultRiskSignals(baseInput).map((s) => s.id);
    expect(ids).toEqual([
      "vault-telemetry",
      "control-plane",
      "stake-snapshot",
      "quote-guard",
      "withdrawal-liquidity",
      "reward-proof",
    ]);
  });

  it.each([
    [true, "Live", "healthy"],
    [false, "Gated", "warning"],
  ])(
    "vault-telemetry with hasAuthoritativeState=%s -> %s/%s",
    (hasAuthoritativeState, status, tone) => {
      const s = signal(
        { ...baseInput, hasAuthoritativeState },
        "vault-telemetry",
      );
      expect(s.status).toBe(status);
      expect(s.tone).toBe(tone);
    },
  );

  it.each([
    // controlPlaneAvailable, warningCount, epochSource, expectedStatus, expectedTone
    [false, 0, "live", "Pending", "warning"],
    [true, 0, "live", "No warnings", "healthy"],
    [true, 1, "live", "1 warning", "warning"],
    [true, 3, "live", "3 warnings", "warning"],
    [true, 0, "fallback-x", "Fallback epoch", "warning"],
  ])(
    "control-plane (avail=%s warn=%d epoch=%s) -> %s/%s",
    (controlPlaneAvailable, warn, epochSource, status, tone) => {
      const s = signal(
        {
          ...baseInput,
          controlPlaneAvailable,
          controlPlaneWarningCount: warn,
          epochSource,
        },
        "control-plane",
      );
      expect(s.status).toBe(status);
      expect(s.tone).toBe(tone);
    },
  );

  it("treats a null warning count as zero", () => {
    const s = signal(
      { ...baseInput, controlPlaneWarningCount: null },
      "control-plane",
    );
    expect(s.status).toBe("No warnings");
  });

  it("treats a null epoch source as non-fallback", () => {
    const s = signal({ ...baseInput, epochSource: null }, "control-plane");
    expect(s.status).toBe("No warnings");
  });

  it.each([
    [true, "Complete", "healthy"],
    [false, "Partial", "blocked"],
    [null, "Unavailable", "warning"],
  ])(
    "stake-snapshot with complete=%s -> %s/%s",
    (stakeSnapshotComplete, status, tone) => {
      const s = signal(
        {
          ...baseInput,
          stakeSnapshotComplete: stakeSnapshotComplete as boolean | null,
        },
        "stake-snapshot",
      );
      expect(s.status).toBe(status);
      expect(s.tone).toBe(tone);
    },
  );

  it("keeps the static signals constant regardless of input", () => {
    const gated = buildVaultRiskSignals({
      hasAuthoritativeState: false,
      controlPlaneAvailable: false,
      controlPlaneWarningCount: 9,
      epochSource: "fallback",
      stakeSnapshotComplete: false,
    });
    expect(gated.find((s) => s.id === "quote-guard")!.tone).toBe("healthy");
    expect(gated.find((s) => s.id === "withdrawal-liquidity")!.tone).toBe(
      "warning",
    );
    expect(gated.find((s) => s.id === "reward-proof")!.tone).toBe("healthy");
  });
});

describe("vaultRisk buildWithdrawalLiquiditySummary", () => {
  const base: WithdrawalLiquidityInput = {
    requestCount: 0,
    pendingCount: 0,
    readyCount: 0,
    claimedCount: 0,
    hasLiveExchangeRate: true,
  };

  it("returns the three fixed signal ids", () => {
    expect(buildWithdrawalLiquiditySummary(base).map((s) => s.id)).toEqual([
      "live-queue",
      "quote-status",
      "instant-exit",
    ]);
  });

  it.each([
    [0, "No requests", "warning"],
    [1, "1 request", "healthy"],
    [5, "5 requests", "healthy"],
  ])(
    "live-queue with requestCount=%d -> %s/%s",
    (requestCount, status, tone) => {
      const s = buildWithdrawalLiquiditySummary({ ...base, requestCount }).find(
        (x) => x.id === "live-queue",
      )!;
      expect(s.status).toBe(status);
      expect(s.tone).toBe(tone);
    },
  );

  it("summarizes pending/ready/claimed counts in the detail", () => {
    const s = buildWithdrawalLiquiditySummary({
      ...base,
      requestCount: 6,
      pendingCount: 2,
      readyCount: 3,
      claimedCount: 1,
    }).find((x) => x.id === "live-queue")!;
    expect(s.detail).toBe("2 pending, 3 ready, 1 claimed.");
  });

  it.each([
    [true, "Live rate", "healthy"],
    [false, "Rate unavailable", "warning"],
  ])(
    "quote-status with hasLiveExchangeRate=%s -> %s/%s",
    (rate, status, tone) => {
      const s = buildWithdrawalLiquiditySummary({
        ...base,
        hasLiveExchangeRate: rate,
      }).find((x) => x.id === "quote-status")!;
      expect(s.status).toBe(status);
      expect(s.tone).toBe(tone);
    },
  );

  it("always marks instant exit as blocked", () => {
    const s = buildWithdrawalLiquiditySummary(base).find(
      (x) => x.id === "instant-exit",
    )!;
    expect(s.tone).toBe("blocked");
    expect(s.status).toBe("Not guaranteed");
  });
});

describe("vaultRisk static disclosures", () => {
  it("exposes four risk disclosures, each with title and body", () => {
    expect(VAULT_RISK_DISCLOSURES).toHaveLength(4);
    for (const d of VAULT_RISK_DISCLOSURES) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.body.length).toBeGreaterThan(0);
    }
  });

  it("exposes four withdrawal-liquidity checkpoints", () => {
    expect(WITHDRAWAL_LIQUIDITY_CHECKPOINTS).toHaveLength(4);
    expect(WITHDRAWAL_LIQUIDITY_CHECKPOINTS.map((c) => c.title)).toEqual([
      "Request",
      "Cooldown",
      "Claim",
      "Secondary liquidity",
    ]);
  });
});
