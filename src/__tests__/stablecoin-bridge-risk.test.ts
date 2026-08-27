import { StablecoinPhase } from "@/lib/constants";
import {
  buildBridgeReadinessSignals,
  STABLECOIN_BRIDGE_DISCLOSURES,
  STABLECOIN_BRIDGE_STEPS,
} from "@/lib/stablecoinBridgeRisk";

describe("stablecoin bridge risk intelligence", () => {
  it("surfaces healthy bridge readiness when asset, config, wallet, and allowance are ready", () => {
    const signals = buildBridgeReadinessSignals({
      assetSymbol: "USDC",
      assetPhase: StablecoinPhase.ACTIVE,
      configLoading: false,
      configEnabled: true,
      mintPaused: false,
      dailyTxLimit: 5_000_000n,
      mintCeilingPerEpoch: 10_000_000n,
      walletConnected: true,
      wrongNetwork: false,
      allowanceLoading: false,
      approvalRequired: false,
      amountEntered: true,
      parsedAmount: 1_000_000n,
      destinationDomain: 0,
    });

    expect(signals.find((signal) => signal.id === "asset-phase")).toMatchObject(
      {
        status: "USDC active",
        tone: "healthy",
      },
    );
    expect(
      signals.find((signal) => signal.id === "on-chain-config"),
    ).toMatchObject({
      status: "Enabled",
      tone: "healthy",
    });
    expect(signals.find((signal) => signal.id === "approval")).toMatchObject({
      status: "Covered",
      tone: "healthy",
    });
    expect(
      signals.find((signal) => signal.id === "bridge-limits"),
    ).toMatchObject({
      status: "Within limits",
      tone: "healthy",
    });
    expect(
      signals.find((signal) => signal.id === "destination-domain"),
    ).toMatchObject({
      status: "Domain 0",
      tone: "healthy",
    });
    expect(
      signals.find((signal) => signal.id === "pre-sign-simulation"),
    ).toMatchObject({
      status: "Enforced",
      tone: "healthy",
    });
  });

  it("blocks read-only assets and paused live bridge config", () => {
    const signals = buildBridgeReadinessSignals({
      assetSymbol: "USDT",
      assetPhase: StablecoinPhase.READ_ONLY,
      configLoading: false,
      configEnabled: true,
      mintPaused: true,
      dailyTxLimit: 5_000_000n,
      mintCeilingPerEpoch: 10_000_000n,
      walletConnected: true,
      wrongNetwork: false,
      allowanceLoading: false,
      approvalRequired: false,
      amountEntered: true,
      parsedAmount: 1_000_000n,
      destinationDomain: 3,
    });

    expect(signals.find((signal) => signal.id === "asset-phase")).toMatchObject(
      {
        status: "USDT read-only",
        tone: "blocked",
      },
    );
    expect(
      signals.find((signal) => signal.id === "on-chain-config"),
    ).toMatchObject({
      status: "Mint paused",
      tone: "blocked",
    });
  });

  it("warns when user action or live reads are still required", () => {
    const signals = buildBridgeReadinessSignals({
      assetSymbol: "USDC",
      assetPhase: StablecoinPhase.ACTIVE,
      configLoading: true,
      configEnabled: null,
      mintPaused: null,
      dailyTxLimit: null,
      mintCeilingPerEpoch: null,
      walletConnected: false,
      wrongNetwork: false,
      allowanceLoading: true,
      approvalRequired: false,
      amountEntered: false,
      parsedAmount: 0n,
      destinationDomain: 6,
    });

    expect(
      signals.find((signal) => signal.id === "on-chain-config"),
    ).toMatchObject({
      status: "Verifying",
      tone: "warning",
    });
    expect(signals.find((signal) => signal.id === "wallet")).toMatchObject({
      status: "Not connected",
      tone: "warning",
    });
    expect(signals.find((signal) => signal.id === "approval")).toMatchObject({
      status: "Loading allowance",
      tone: "warning",
    });
    expect(
      signals.find((signal) => signal.id === "bridge-limits"),
    ).toMatchObject({
      status: "Verifying",
      tone: "warning",
    });
  });

  it("blocks amounts that exceed live bridge limits before signing", () => {
    const signals = buildBridgeReadinessSignals({
      assetSymbol: "USDC",
      assetPhase: StablecoinPhase.ACTIVE,
      configLoading: false,
      configEnabled: true,
      mintPaused: false,
      dailyTxLimit: 2_000_000n,
      mintCeilingPerEpoch: 10_000_000n,
      walletConnected: true,
      wrongNetwork: false,
      allowanceLoading: false,
      approvalRequired: false,
      amountEntered: true,
      parsedAmount: 3_000_000n,
      destinationDomain: 6,
    });

    expect(
      signals.find((signal) => signal.id === "bridge-limits"),
    ).toMatchObject({
      status: "Daily limit exceeded",
      tone: "blocked",
    });
  });

  it("warns when live config reports no explicit bridge cap", () => {
    const signals = buildBridgeReadinessSignals({
      assetSymbol: "USDC",
      assetPhase: StablecoinPhase.ACTIVE,
      configLoading: false,
      configEnabled: true,
      mintPaused: false,
      dailyTxLimit: 0n,
      mintCeilingPerEpoch: 0n,
      walletConnected: true,
      wrongNetwork: false,
      allowanceLoading: false,
      approvalRequired: false,
      amountEntered: false,
      parsedAmount: 0n,
      destinationDomain: 6,
    });

    expect(
      signals.find((signal) => signal.id === "bridge-limits"),
    ).toMatchObject({
      status: "No explicit cap",
      tone: "warning",
    });
  });

  it("keeps settlement, fee, domain, and lifecycle disclosures explicit", () => {
    const disclosureText = STABLECOIN_BRIDGE_DISCLOSURES.map(
      (item) => `${item.title} ${item.body}`,
    ).join(" ");

    expect(disclosureText).toContain("Settlement is asynchronous");
    expect(disclosureText).toContain("Fees are split across actors");
    expect(disclosureText).toContain("On-chain gates can stop flow");
    expect(disclosureText).toContain("Destination-domain mistakes are costly");
    expect(STABLECOIN_BRIDGE_STEPS.map((step) => step.title)).toEqual([
      "Approve",
      "Burn or lock",
      "Attest",
      "Receive",
    ]);
  });
});
