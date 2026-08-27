import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSeal } from "@/lib/seals";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("seal API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the seal list only for unsupported detail endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          seals: [{ id: "seal-1", status: "active", createdAt: 0 }],
          total: 1,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSeal("seal-1")).resolves.toMatchObject({
      id: "seal-1",
      detailAvailable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to the seal list on protected detail failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSeal("seal-1")).rejects.toThrow(
      "Failed to fetch seal: HTTP 403",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
