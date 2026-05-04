import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearApiAccessToken,
  getLatestBlock,
  setApiAccessToken,
} from "@/lib/api";

function mockApiResponse() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
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
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function getLastRequestHeaders(fetchMock: ReturnType<typeof vi.fn>) {
  const [, options] = fetchMock.mock.calls.at(-1) ?? [];
  return (options as RequestInit | undefined)?.headers as
    | Record<string, string>
    | undefined;
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

    expect(getLastRequestHeaders(fetchMock)).not.toHaveProperty(
      "Authorization",
    );
  });

  it("sends explicitly provided in-memory bearer tokens", async () => {
    const fetchMock = mockApiResponse();
    setApiAccessToken(" access-token ");

    await getLatestBlock();

    expect(getLastRequestHeaders(fetchMock)).toMatchObject({
      Authorization: "Bearer access-token",
    });
  });
});
