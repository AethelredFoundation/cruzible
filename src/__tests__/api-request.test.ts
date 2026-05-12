import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiHttpError, apiJson, apiRequest } from "@/lib/api-request";
import { BRAND } from "@/lib/constants";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function getLastRequestOptions(fetchMock: ReturnType<typeof vi.fn>) {
  const [, options] = fetchMock.mock.calls.at(-1) ?? [];
  return options as RequestInit | undefined;
}

describe("apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes browser credentials and audit headers by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/validators");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/v1/validators",
      expect.objectContaining({ cache: "no-store", credentials: "include" }),
    );

    const headers = new Headers(getLastRequestOptions(fetchMock)?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-Client-Name")).toBe(BRAND.NAME);
    expect(headers.get("X-Client-Version")).toBe("1.0.0");
  });

  it("allows callers to override credentials deliberately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/validators", { credentials: "omit" });

    expect(getLastRequestOptions(fetchMock)).toMatchObject({
      credentials: "omit",
    });
  });

  it("allows callers to opt into explicit cache behavior", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/validators", { cache: "force-cache" });

    expect(getLastRequestOptions(fetchMock)).toMatchObject({
      cache: "force-cache",
    });
  });

  it("throws typed HTTP errors with server messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "denied" }, { status: 403 }),
        ),
    );

    await expect(apiJson("/validators")).rejects.toMatchObject({
      name: "ApiHttpError",
      message: "denied",
      statusCode: 403,
    } satisfies Partial<ApiHttpError>);
  });
});
