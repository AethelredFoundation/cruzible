import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fetchStablecoinBridgeHistory } from "@/lib/stablecoinHistory";
import { STABLECOIN_ASSETS } from "@/lib/constants";

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function event(id: string, timestamp: string) {
  return {
    id,
    assetId: "0xasset",
    eventType: "bridge_out",
    sender: "aeth1s",
    amount: "1000000",
    destDomain: 6,
    txHash: `0x${id}`,
    blockNumber: "100",
    logIndex: 0,
    timestamp,
  };
}

describe("stablecoinHistory fetchStablecoinBridgeHistory", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests history for each asset and stamps symbol/decimals", async () => {
    fetchMock.mockResolvedValue(
      ok({
        data: [event("a", "2026-07-01T00:00:00Z")],
        pagination: { total: 1, limit: 25, offset: 0 },
      }),
    );
    const rows = await fetchStablecoinBridgeHistory([STABLECOIN_ASSETS.USDC]);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("USDC");
    expect(rows[0].decimals).toBe(6);
  });

  it("merges histories across assets and sorts by timestamp descending", async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok({
          data: [event("old", "2026-06-01T00:00:00Z")],
          pagination: { total: 1, limit: 25, offset: 0 },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          data: [event("new", "2026-07-01T00:00:00Z")],
          pagination: { total: 1, limit: 25, offset: 0 },
        }),
      );
    const rows = await fetchStablecoinBridgeHistory([
      STABLECOIN_ASSETS.USDC,
      STABLECOIN_ASSETS.USDT,
    ]);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("caps the merged result at 25 rows", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      event(
        `e${i}`,
        `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      ),
    );
    // Fresh Response per call — a body can only be read once.
    fetchMock.mockImplementation(async () =>
      ok({ data: many, pagination: { total: 20, limit: 25, offset: 0 } }),
    );
    const rows = await fetchStablecoinBridgeHistory([
      STABLECOIN_ASSETS.USDC,
      STABLECOIN_ASSETS.USDT,
    ]);
    expect(rows.length).toBe(25); // 40 combined, sliced to 25
  });

  it("returns an empty array when no assets are given", async () => {
    const rows = await fetchStablecoinBridgeHistory([]);
    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the per-asset history endpoint with a limit", async () => {
    fetchMock.mockResolvedValue(
      ok({ data: [], pagination: { total: 0, limit: 25, offset: 0 } }),
    );
    await fetchStablecoinBridgeHistory([STABLECOIN_ASSETS.USDC]);
    const url = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
    expect(url).toContain("/stablecoins/");
    expect(url).toContain("/history?limit=25");
  });
});
