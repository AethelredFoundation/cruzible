import { describe, it, expect } from "vitest";

import {
  BRAND,
  CHART_COLORS,
  PRODUCER_NAMES,
  STATUS_STYLES,
  CCTP_DOMAINS,
  getAssetId,
} from "@/lib/constants";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

describe("constants BRAND", () => {
  it("names the app", () => {
    expect(BRAND.NAME).toContain("Cruzible");
  });

  it.each(["red", "redDark", "redLight"] as const)(
    "%s is a hex color",
    (key) => {
      expect(BRAND[key]).toMatch(HEX_COLOR);
    },
  );

  it("exposes a translucent glow color", () => {
    expect(BRAND.redGlow).toContain("rgba");
  });
});

describe("constants CHART_COLORS", () => {
  it("has ten colors", () => {
    expect(CHART_COLORS).toHaveLength(10);
  });

  it.each(CHART_COLORS.map((c, i) => [i, c]))(
    "color %d (%s) is valid hex",
    (_i, color) => {
      expect(color).toMatch(HEX_COLOR);
    },
  );

  it("has no duplicate colors", () => {
    expect(new Set(CHART_COLORS).size).toBe(CHART_COLORS.length);
  });
});

describe("constants PRODUCER_NAMES", () => {
  it("lists at least ten producers", () => {
    expect(PRODUCER_NAMES.length).toBeGreaterThanOrEqual(10);
  });

  it("has no empty or duplicate names", () => {
    expect(PRODUCER_NAMES.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(PRODUCER_NAMES).size).toBe(PRODUCER_NAMES.length);
  });
});

describe("constants STATUS_STYLES", () => {
  it.each(Object.keys(STATUS_STYLES))(
    "%s style has bg/text/dot classes",
    (key) => {
      const style = STATUS_STYLES[key as keyof typeof STATUS_STYLES];
      expect(style.bg).toMatch(/^bg-/);
      expect(style.text).toMatch(/^text-/);
      expect(style.dot).toMatch(/^bg-/);
    },
  );

  it("maps Success and Verified to the same emerald palette", () => {
    expect(STATUS_STYLES.Success.text).toBe(STATUS_STYLES.Verified.text);
  });
});

describe("constants CCTP_DOMAINS", () => {
  it.each([
    ["ETHEREUM", 0],
    ["AVALANCHE", 1],
    ["OPTIMISM", 2],
    ["ARBITRUM", 3],
    ["BASE", 6],
    ["POLYGON", 7],
  ] as const)("%s maps to domain %d", (name, id) => {
    expect(CCTP_DOMAINS[name]).toBe(id);
  });

  it("has unique domain ids", () => {
    const ids = Object.values(CCTP_DOMAINS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("constants getAssetId", () => {
  it.each(["USDC", "USDT", "DAI", "PYUSD"])(
    "returns a 32-byte hex id for %s",
    (symbol) => {
      expect(getAssetId(symbol)).toMatch(/^0x[0-9a-f]{64}$/);
    },
  );

  it("is deterministic", () => {
    expect(getAssetId("USDC")).toBe(getAssetId("USDC"));
  });

  it("is collision-free across distinct symbols", () => {
    const ids = ["USDC", "USDT", "DAI", "PYUSD", "EURC"].map(getAssetId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
