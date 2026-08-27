import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  fetchModelsPage,
  fetchAllModels,
  fetchModelDetail,
} from "@/lib/models";

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
}

function allUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

describe("models fetchModelsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests /models with default params", async () => {
    fetchMock.mockResolvedValue(ok({ models: [], total: 0 }));
    await fetchModelsPage();
    const url = lastUrl(fetchMock);
    expect(url).toContain("/models?");
    expect(url).toContain("offset=0");
    expect(url).toContain("sort=registered_at%3Adesc");
  });

  it("serializes category/verified/owner filters", async () => {
    fetchMock.mockResolvedValue(ok({ models: [], total: 0 }));
    await fetchModelsPage({
      category: "VISION",
      verified: true,
      owner: "aeth1o",
    });
    const url = lastUrl(fetchMock);
    expect(url).toContain("category=VISION");
    expect(url).toContain("verified=true");
    expect(url).toContain("owner=aeth1o");
  });

  it("serializes verified=false explicitly", async () => {
    fetchMock.mockResolvedValue(ok({ models: [], total: 0 }));
    await fetchModelsPage({ verified: false });
    expect(lastUrl(fetchMock)).toContain("verified=false");
  });

  it("omits verified when undefined", async () => {
    fetchMock.mockResolvedValue(ok({ models: [], total: 0 }));
    await fetchModelsPage({});
    expect(lastUrl(fetchMock)).not.toContain("verified=");
  });

  it("defaults total to the number of models when total is absent", async () => {
    fetchMock.mockResolvedValue(
      ok({ models: [{ modelHash: "0x1" }, { modelHash: "0x2" }] }),
    );
    const res = await fetchModelsPage();
    expect(res.total).toBe(2);
    expect(res.models).toHaveLength(2);
  });

  it("handles a non-array models payload as empty", async () => {
    fetchMock.mockResolvedValue(ok({ models: null, total: 0 }));
    const res = await fetchModelsPage();
    expect(res.models).toEqual([]);
  });
});

describe("models fetchAllModels (pagination)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the first page when total fits in one page", async () => {
    fetchMock.mockResolvedValue(
      ok({ models: [{ modelHash: "0x1" }], total: 1 }),
    );
    const res = await fetchAllModels();
    expect(res.total).toBe(1);
    expect(res.models).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches additional pages when total exceeds the first page", async () => {
    const page = (n: number, total: number) =>
      ok({
        models: Array.from({ length: n }, (_, i) => ({ modelHash: `0x${i}` })),
        total,
      });
    // First page reports a large total, triggering follow-up requests.
    fetchMock
      .mockResolvedValueOnce(page(50, 120))
      .mockResolvedValueOnce(page(50, 120))
      .mockResolvedValueOnce(page(20, 120));
    const res = await fetchAllModels();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(res.total).toBe(120);
    // Subsequent requests use increasing offsets
    const offsets = allUrls(fetchMock).map((u) =>
      new URL(u, "http://x").searchParams.get("offset"),
    );
    expect(offsets).toContain("0");
    expect(offsets).toContain("50");
  });
});

describe("models fetchModelDetail", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("encodes the model hash in the path", async () => {
    fetchMock.mockResolvedValue(ok({ registry: { modelHash: "0x1" } }));
    await fetchModelDetail("0x abc");
    expect(lastUrl(fetchMock)).toContain("/models/0x%20abc");
  });

  it("returns a detail record with source 'detail' on success", async () => {
    fetchMock.mockResolvedValue(
      ok({ model: { modelHash: "0x1" }, sizeBytes: "1024" }),
    );
    const detail = await fetchModelDetail("0x1");
    expect(detail.source).toBe("detail");
    expect(detail.sizeBytes).toBe("1024");
  });

  it("throws 'Model not found' on 404", async () => {
    fetchMock.mockResolvedValue(ok({}, 404));
    await expect(fetchModelDetail("0x1")).rejects.toThrow("Model not found");
  });

  it.each([405, 501])("throws 'unavailable' on HTTP %d", async (status) => {
    fetchMock.mockResolvedValue(ok({}, status));
    await expect(fetchModelDetail("0x1")).rejects.toThrow("unavailable");
  });

  it("throws a generic error on other failures", async () => {
    fetchMock.mockResolvedValue(ok({}, 500));
    await expect(fetchModelDetail("0x1")).rejects.toThrow(
      "Failed to fetch model detail",
    );
  });
});
