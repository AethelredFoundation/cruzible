import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllModels, fetchModelDetail } from "@/lib/models";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("fetchModelDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns authoritative detail responses without downgrading source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          registry: {
            modelHash: "model-1",
            name: "Cruzible Model",
            owner: "owner",
            architecture: "transformer",
            version: "1.0.0",
            category: "GENERAL",
            inputSchema: "{}",
            outputSchema: "{}",
            storageUri: "ipfs://model",
            registeredAt: "2026-01-01T00:00:00.000Z",
            verified: true,
            totalJobs: 7,
          },
          usage: {
            totalJobs: 7,
            proofTypeBreakdown: [],
          },
          lineage: {
            recentJobs: [],
          },
          sizeBytes: "1024",
          updatedAt: "2026-01-02T00:00:00.000Z",
        }),
      ),
    );

    await expect(fetchModelDetail("model-1")).resolves.toMatchObject({
      source: "detail",
      registry: {
        modelHash: "model-1",
        name: "Cruzible Model",
      },
      usage: {
        totalJobs: 7,
      },
    });
  });

  it("fails closed on missing detail instead of fetching broad list fallback data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "missing" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchModelDetail("missing-model")).rejects.toThrow(
      "Model not found",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:4001/v1/models/missing-model",
    );
  });
});

describe("fetchAllModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caps broad model universe fetches to prevent client-side request storms", async () => {
    const pageModels = Array.from({ length: 100 }, (_, index) => ({
      modelHash: `model-${index}`,
      name: `Model ${index}`,
      owner: "owner",
      architecture: "transformer",
      version: "1.0.0",
      category: "GENERAL",
      inputSchema: "{}",
      outputSchema: "{}",
      storageUri: "ipfs://model",
      registeredAt: "2026-01-01T00:00:00.000Z",
      verified: true,
      totalJobs: index,
    }));
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ models: pageModels, total: 10_000 })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAllModels();

    expect(result.total).toBe(10_000);
    expect(result.models).toHaveLength(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "http://localhost:4001/v1/models?limit=100&offset=900&sort=registered_at%3Adesc",
    );
  });
});
