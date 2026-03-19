/**
 * Stablecoin Registry — Unit Tests
 *
 * Tests the stablecoin asset registry constants and helper functions
 * defined in src/lib/constants.ts.
 */

import {
  getAssetId,
  isStablecoinEnabled,
  getEnabledStablecoins,
  getAllStablecoins,
  STABLECOIN_ASSETS,
  StablecoinPhase,
  StablecoinRoutingType,
  CCTP_DOMAINS,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// getAssetId()
// ---------------------------------------------------------------------------

describe("getAssetId", () => {
  it("produces a valid bytes32 hex string", () => {
    const id = getAssetId("USDC");

    expect(id).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("produces deterministic results for the same symbol", () => {
    const a = getAssetId("USDC");
    const b = getAssetId("USDC");

    expect(a).toBe(b);
  });

  it("produces different hashes for different symbols", () => {
    const usdcId = getAssetId("USDC");
    const usdtId = getAssetId("USDT");

    expect(usdcId).not.toBe(usdtId);
  });

  it("matches the pre-computed assetId in STABLECOIN_ASSETS", () => {
    expect(getAssetId("USDC")).toBe(STABLECOIN_ASSETS.USDC.assetId);
    expect(getAssetId("USDT")).toBe(STABLECOIN_ASSETS.USDT.assetId);
  });
});

// ---------------------------------------------------------------------------
// isStablecoinEnabled()
// ---------------------------------------------------------------------------

describe("isStablecoinEnabled", () => {
  it("returns true for ACTIVE phase assets", () => {
    expect(isStablecoinEnabled(STABLECOIN_ASSETS.USDC)).toBe(true);
  });

  it("returns false for READ_ONLY phase assets", () => {
    expect(isStablecoinEnabled(STABLECOIN_ASSETS.USDT)).toBe(false);
  });

  it("returns false for COMING_SOON phase assets", () => {
    const comingSoonAsset = {
      ...STABLECOIN_ASSETS.USDC,
      phase: StablecoinPhase.COMING_SOON,
    };
    expect(isStablecoinEnabled(comingSoonAsset)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STABLECOIN_ASSETS registry
// ---------------------------------------------------------------------------

describe("STABLECOIN_ASSETS", () => {
  it("contains USDC with ACTIVE phase", () => {
    const usdc = STABLECOIN_ASSETS.USDC;

    expect(usdc).toBeDefined();
    expect(usdc.symbol).toBe("USDC");
    expect(usdc.name).toBe("USD Coin");
    expect(usdc.decimals).toBe(6);
    expect(usdc.phase).toBe(StablecoinPhase.ACTIVE);
    expect(usdc.routingType).toBe(StablecoinRoutingType.CCTP_V2);
  });

  it("contains USDT with READ_ONLY phase", () => {
    const usdt = STABLECOIN_ASSETS.USDT;

    expect(usdt).toBeDefined();
    expect(usdt.symbol).toBe("USDT");
    expect(usdt.name).toBe("Tether USD");
    expect(usdt.decimals).toBe(6);
    expect(usdt.phase).toBe(StablecoinPhase.READ_ONLY);
  });

  it("uses 6 decimals for all stablecoins (not 18)", () => {
    for (const asset of Object.values(STABLECOIN_ASSETS)) {
      expect(asset.decimals).toBe(6);
    }
  });

  it("has valid assetId for all entries (bytes32 hex)", () => {
    for (const asset of Object.values(STABLECOIN_ASSETS)) {
      expect(asset.assetId).toMatch(/^0x[a-f0-9]{64}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// getEnabledStablecoins() / getAllStablecoins()
// ---------------------------------------------------------------------------

describe("getEnabledStablecoins", () => {
  it("returns only ACTIVE phase assets", () => {
    const enabled = getEnabledStablecoins();

    expect(enabled.length).toBeGreaterThan(0);
    for (const asset of enabled) {
      expect(asset.phase).toBe(StablecoinPhase.ACTIVE);
    }
  });

  it("includes USDC but not USDT", () => {
    const enabled = getEnabledStablecoins();
    const symbols = enabled.map((a) => a.symbol);

    expect(symbols).toContain("USDC");
    expect(symbols).not.toContain("USDT");
  });
});

describe("getAllStablecoins", () => {
  it("returns all registered stablecoins regardless of phase", () => {
    const all = getAllStablecoins();
    const symbols = all.map((a) => a.symbol);

    expect(symbols).toContain("USDC");
    expect(symbols).toContain("USDT");
  });

  it("has at least 2 entries", () => {
    expect(getAllStablecoins().length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// CCTP_DOMAINS
// ---------------------------------------------------------------------------

describe("CCTP_DOMAINS", () => {
  it("defines Ethereum as domain 0", () => {
    expect(CCTP_DOMAINS.ETHEREUM).toBe(0);
  });

  it("includes standard CCTP domains", () => {
    expect(CCTP_DOMAINS.AVALANCHE).toBeDefined();
    expect(CCTP_DOMAINS.OPTIMISM).toBeDefined();
    expect(CCTP_DOMAINS.ARBITRUM).toBeDefined();
    expect(CCTP_DOMAINS.BASE).toBeDefined();
  });
});
