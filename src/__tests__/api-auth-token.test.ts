import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearApiAccessToken,
  getLatestBlock,
  setApiAccessToken,
} from "@/lib/api";

function mockApiResponse() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          gas_limit: 0,
          gas_used: 0,
          hash: "0xabc",
          height: 1,
          num_txs: 0,
          proposer: "validator",
          timestamp: "2026-05-05T00:00:00.000Z",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function getLastRequestHeaders(fetchMock: ReturnType<typeof vi.fn>) {
  const [, options] = fetchMock.mock.calls.at(-1) ?? [];
  return new Headers((options as RequestInit | undefined)?.headers);
}

function getLastRequestOptions(fetchMock: ReturnType<typeof vi.fn>) {
  const [, options] = fetchMock.mock.calls.at(-1) ?? [];
  return options as RequestInit | undefined;
}

describe("API bearer token handling", () => {
  afterEach(() => {
    clearApiAccessToken();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("does not read bearer tokens from persistent browser storage", async () => {
    window.localStorage.setItem("auth_token", "persisted-token");
    const fetchMock = mockApiResponse();

    await getLatestBlock();

    expect(getLastRequestHeaders(fetchMock).has("Authorization")).toBe(false);
  });

  it("sends explicitly provided in-memory bearer tokens", async () => {
    const fetchMock = mockApiResponse();
    setApiAccessToken(" access-token ");

    await getLatestBlock();

    expect(getLastRequestHeaders(fetchMock).get("Authorization")).toBe(
      "Bearer access-token",
    );
  });

  it("includes browser cookies for API requests by default", async () => {
    const fetchMock = mockApiResponse();

    await getLatestBlock();

    expect(getLastRequestOptions(fetchMock)).toMatchObject({
      credentials: "include",
    });
  });
});
