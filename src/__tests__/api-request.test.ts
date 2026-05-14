import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiHttpError,
  DEFAULT_API_TIMEOUT_MS,
  apiJson,
  apiRequest,
} from "@/lib/api-request";
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
    vi.useRealTimers();
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

  it("does not allow callers to weaken credential handling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/validators", { credentials: "omit" });

    expect(getLastRequestOptions(fetchMock)).toMatchObject({
      credentials: "include",
    });
  });

  it("does not allow callers to opt into API response caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/validators", { cache: "force-cache" });

    expect(getLastRequestOptions(fetchMock)).toMatchObject({
      cache: "no-store",
    });
  });

  it("aborts slow API requests with the default timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit | undefined) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error("missing request abort signal"));
            return;
          }

          signal.addEventListener(
            "abort",
            () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            },
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = apiRequest("/validators");
    const assertion = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS);

    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid caller-provided request timeouts", async () => {
    await expect(apiRequest("/validators", { timeoutMs: 0 })).rejects.toThrow(
      "API request timeout must be a positive finite number",
    );
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
