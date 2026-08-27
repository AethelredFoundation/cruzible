import { describe, it, expect } from "vitest";

import {
  buildBridgeReadinessSignals,
  STABLECOIN_BRIDGE_DISCLOSURES,
  STABLECOIN_BRIDGE_STEPS,
  type BridgeReadinessInput,
} from "@/lib/stablecoinBridgeRisk";
import { StablecoinPhase } from "@/lib/constants";

function input(
  overrides: Partial<BridgeReadinessInput> = {},
): BridgeReadinessInput {
  return {
    assetSymbol: "USDC",
    assetPhase: StablecoinPhase.ACTIVE,
    configLoading: false,
    configEnabled: true,
    mintPaused: false,
    dailyTxLimit: 1000n,
    mintCeilingPerEpoch: 5000n,
    walletConnected: true,
    wrongNetwork: false,
    allowanceLoading: false,
    approvalRequired: false,
    amountEntered: true,
    parsedAmount: 100n,
    destinationDomain: 6,
    ...overrides,
  };
}

function sig(over: Partial<BridgeReadinessInput>, id: string) {
  return buildBridgeReadinessSignals(input(over)).find((s) => s.id === id)!;
}

describe("stablecoinBridgeRisk buildBridgeReadinessSignals", () => {
  it("returns the seven fixed signal ids in order", () => {
    expect(buildBridgeReadinessSignals(input()).map((s) => s.id)).toEqual([
      "asset-phase",
      "on-chain-config",
      "wallet",
      "approval",
      "bridge-limits",
      "destination-domain",
      "pre-sign-simulation",
    ]);
  });

  it.each([
    [StablecoinPhase.ACTIVE, "USDC active", "healthy"],
    [StablecoinPhase.READ_ONLY, "USDC read-only", "blocked"],
    [StablecoinPhase.COMING_SOON, "Unavailable", "blocked"],
    [null, "Unavailable", "blocked"],
  ])("asset-phase %s -> %s/%s", (phase, status, tone) => {
    const s = sig(
      { assetPhase: phase as StablecoinPhase | null },
      "asset-phase",
    );
    expect(s.status).toBe(status);
    expect(s.tone).toBe(tone);
  });

  it.each([
    [{ configLoading: true }, "Verifying", "warning"],
    [{ configEnabled: false }, "Disabled", "blocked"],
    [{ mintPaused: true }, "Mint paused", "blocked"],
    [{}, "Enabled", "healthy"],
  ])("on-chain-config %o -> %s/%s", (over, status, tone) => {
    const s = sig(over, "on-chain-config");
    expect(s.status).toBe(status);
    expect(s.tone).toBe(tone);
  });

  it.each([
    [{ walletConnected: false }, "Not connected", "warning"],
    [{ wrongNetwork: true }, "Wrong network", "blocked"],
    [{}, "Ready", "healthy"],
  ])("wallet %o -> %s/%s", (over, status, tone) => {
    const s = sig(over, "wallet");
    expect(s.status).toBe(status);
    expect(s.tone).toBe(tone);
  });

  it.each([
    [{ allowanceLoading: true }, "Loading allowance", "warning"],
    [{ amountEntered: false }, "Enter amount", "warning"],
    [{ approvalRequired: true }, "Required", "warning"],
    [{}, "Covered", "healthy"],
  ])("approval %o -> %s/%s", (over, status, tone) => {
    const s = sig(over, "approval");
    expect(s.status).toBe(status);
    expect(s.tone).toBe(tone);
  });

  it.each([
    [{ configLoading: true }, "Verifying", "warning"],
    [{ parsedAmount: 2000n }, "Daily limit exceeded", "blocked"],
    [
      { dailyTxLimit: 0n, parsedAmount: 6000n },
      "Epoch ceiling exceeded",
      "blocked",
    ],
    [
      { dailyTxLimit: 0n, mintCeilingPerEpoch: 0n },
      "No explicit cap",
      "warning",
    ],
    [{}, "Within limits", "healthy"],
    [{ amountEntered: false }, "Configured", "healthy"],
  ])("bridge-limits %o -> %s/%s", (over, status, tone) => {
    const s = sig(over, "bridge-limits");
    expect(s.status).toBe(status);
    expect(s.tone).toBe(tone);
  });

  it("reports the destination domain", () => {
    expect(sig({ destinationDomain: 3 }, "destination-domain").status).toBe(
      "Domain 3",
    );
  });

  it("always enforces pre-sign simulation", () => {
    const s = sig({}, "pre-sign-simulation");
    expect(s.status).toBe("Enforced");
    expect(s.tone).toBe("healthy");
  });

  it("checks the daily limit before the epoch ceiling when both exceeded", () => {
    const s = sig({ parsedAmount: 9999n }, "bridge-limits");
    expect(s.status).toBe("Daily limit exceeded");
  });
});

describe("stablecoinBridgeRisk static content", () => {
  it("exposes disclosures with title and body", () => {
    expect(STABLECOIN_BRIDGE_DISCLOSURES.length).toBeGreaterThan(0);
    for (const d of STABLECOIN_BRIDGE_DISCLOSURES) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.body.length).toBeGreaterThan(0);
    }
  });

  it("exposes ordered bridge steps", () => {
    expect(STABLECOIN_BRIDGE_STEPS.length).toBeGreaterThan(0);
  });
});
