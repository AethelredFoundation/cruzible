import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  apiJson,
  apiRequest,
  parseApiJsonResponse,
  ApiHttpError,
  DEFAULT_API_TIMEOUT_MS,
} from "@/lib/api-request";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("api-request ApiHttpError", () => {
  it("carries a status code and payload", () => {
    const err = new ApiHttpError("nope", 418, { message: "teapot" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiHttpError");
    expect(err.statusCode).toBe(418);
    expect(err.payload).toEqual({ message: "teapot" });
  });
});

describe("api-request parseApiJsonResponse", () => {
  it("returns undefined for a 204", async () => {
    const res = new Response(null, { status: 204 });
    expect(await parseApiJsonResponse(res)).toBeUndefined();
  });

  it("returns undefined for an empty body", async () => {
    const res = new Response("   ", { status: 200 });
    expect(await parseApiJsonResponse(res)).toBeUndefined();
  });

  it("parses a valid JSON body", async () => {
    const res = jsonResponse({ ok: true, n: 5 });
    expect(await parseApiJsonResponse<{ ok: boolean; n: number }>(res)).toEqual(
      { ok: true, n: 5 },
    );
  });

  it("throws for invalid JSON", async () => {
    const res = new Response("{not json", { status: 200 });
    await expect(parseApiJsonResponse(res)).rejects.toThrow(
      "API returned invalid JSON",
    );
  });
});

describe("api-request apiRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends default Accept and client headers", async () => {
    await apiRequest("/health");
    const [, options] = fetchMock.mock.calls.at(-1)!;
    const headers = options.headers as Headers;
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-Client-Name")).toBeTruthy();
    expect(headers.get("X-Client-Version")).toBeTruthy();
  });

  it("sets Content-Type for a non-FormData body", async () => {
    await apiRequest("/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const [, options] = fetchMock.mock.calls.at(-1)!;
    expect((options.headers as Headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("does not override an explicit Content-Type", async () => {
    await apiRequest("/x", {
      method: "POST",
      body: "raw",
      headers: { "Content-Type": "text/plain" },
    });
    const [, options] = fetchMock.mock.calls.at(-1)!;
    expect((options.headers as Headers).get("Content-Type")).toBe("text/plain");
  });

  it("includes credentials and no-store cache", async () => {
    await apiRequest("/x");
    const [, options] = fetchMock.mock.calls.at(-1)!;
    expect(options.credentials).toBe("include");
    expect(options.cache).toBe("no-store");
  });

  it("rejects a non-positive timeout", async () => {
    await expect(apiRequest("/x", { timeoutMs: 0 })).rejects.toThrow(
      "timeout must be a positive finite number",
    );
    await expect(apiRequest("/x", { timeoutMs: -5 })).rejects.toThrow();
  });

  it("uses the default timeout constant when unset", () => {
    expect(DEFAULT_API_TIMEOUT_MS).toBe(12_000);
  });

  it("passes an abort signal to fetch", async () => {
    await apiRequest("/x");
    const [, options] = fetchMock.mock.calls.at(-1)!;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("api-request apiJson", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ value: 42 }));
    expect(await apiJson<{ value: number }>("/x")).toEqual({ value: 42 });
  });

  it("throws ApiHttpError with the server message on failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: "not allowed" }, { status: 403 }),
    );
    await expect(apiJson("/x")).rejects.toMatchObject({
      name: "ApiHttpError",
      statusCode: 403,
      message: "not allowed",
    });
  });

  it("uses the fallback message when the error payload has none", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await expect(
      apiJson("/x", { fallbackMessage: "custom fail" }),
    ).rejects.toMatchObject({
      message: "custom fail",
      statusCode: 500,
    });
  });

  it("defaults the error message to the HTTP status when no fallback", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 502 }));
    await expect(apiJson("/x")).rejects.toThrow("HTTP 502");
  });

  it("returns undefined for a 204 success", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiJson("/x")).toBeUndefined();
  });
});
