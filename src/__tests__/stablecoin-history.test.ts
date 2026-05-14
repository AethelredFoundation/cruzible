import { beforeEach, describe, expect, it, vi } from "vitest";
import { StablecoinPhase, StablecoinRoutingType } from "@/lib/constants";
import {
  fetchStablecoinBridgeHistory,
  formatStablecoinAmount,
  shortStablecoinHash,
} from "@/lib/stablecoinHistory";
import { apiJson } from "@/lib/api-request";

vi.mock("@/lib/api-request", () => ({
  apiJson: vi.fn(),
}));

const apiJsonMock = vi.mocked(apiJson);

const usdc = {
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  assetId: "0xusdc",
  routingType: StablecoinRoutingType.CCTP_V2,
  phase: StablecoinPhase.ACTIVE,
  logoPath: "/tokens/usdc.svg",
} as const;

const usdt = {
  symbol: "USDT",
  name: "Tether USD",
  decimals: 6,
  assetId: "0xusdt",
  routingType: StablecoinRoutingType.CCTP_V2,
  phase: StablecoinPhase.READ_ONLY,
  logoPath: "/tokens/usdt.svg",
} as const;

describe("stablecoin bridge history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats base-unit stablecoin amounts without floating point rounding", () => {
    expect(formatStablecoinAmount("1234500", 6)).toBe("1.2345");
    expect(formatStablecoinAmount("1000000", 6)).toBe("1");
    expect(formatStablecoinAmount("not-a-number", 6)).toBe("unavailable");
  });

  it("shortens hashes for table display", () => {
    expect(shortStablecoinHash("0x1234567890abcdef")).toBe("0x123456...abcdef");
    expect(shortStablecoinHash("0x1234")).toBe("0x1234");
  });

  it("loads, annotates, sorts, and caps bridge history across assets", async () => {
    apiJsonMock
      .mockResolvedValueOnce({
        data: [
          {
            id: "older-usdc",
            assetId: usdc.assetId,
            eventType: "CCTPBurnInitiated",
            sender: "0x1111111111111111111111111111111111111111",
            amount: "1000000",
            destDomain: 0,
            txHash: "0xaaa",
            blockNumber: "10",
            logIndex: 0,
            timestamp: "2026-05-14T01:00:00.000Z",
          },
        ],
        pagination: { total: 1, limit: 25, offset: 0 },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "newer-usdt",
            assetId: usdt.assetId,
            eventType: "MintExecuted",
            sender: "0x2222222222222222222222222222222222222222",
            amount: "2000000",
            destDomain: null,
            txHash: "0xbbb",
            blockNumber: "11",
            logIndex: 1,
            timestamp: "2026-05-14T02:00:00.000Z",
          },
        ],
        pagination: { total: 1, limit: 25, offset: 0 },
      });

    const rows = await fetchStablecoinBridgeHistory([usdc, usdt]);

    expect(apiJsonMock).toHaveBeenCalledWith(
      "/stablecoins/0xusdc/history?limit=25",
      { fallbackMessage: "Failed to load USDC bridge history" },
    );
    expect(apiJsonMock).toHaveBeenCalledWith(
      "/stablecoins/0xusdt/history?limit=25",
      { fallbackMessage: "Failed to load USDT bridge history" },
    );
    expect(rows.map((row) => row.id)).toEqual(["newer-usdt", "older-usdc"]);
    expect(rows[0]).toMatchObject({ symbol: "USDT", decimals: 6 });
    expect(rows[1]).toMatchObject({ symbol: "USDC", decimals: 6 });
  });
});
