import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getBlocks,
  getBlock,
  getLatestBlock,
  getTransactions,
  getTransaction,
  getValidators,
  getValidator,
  getJobs,
  getJob,
  submitJob,
  getStakingInfo,
  getStakingValidators,
  getNetworkStats,
  setApiAccessToken,
  clearApiAccessToken,
} from "@/lib/api";

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
}

function lastInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return (fetchMock.mock.calls.at(-1)?.[1] ?? {}) as RequestInit;
}

describe("api endpoints (path + query construction)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(ok({ success: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    clearApiAccessToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearApiAccessToken();
  });

  it("getBlocks uses default page/limit", async () => {
    await getBlocks();
    expect(lastUrl(fetchMock)).toContain("/blocks?page=1&limit=50");
  });

  it("getBlocks passes custom page/limit", async () => {
    await getBlocks(3, 10);
    expect(lastUrl(fetchMock)).toContain("/blocks?page=3&limit=10");
  });

  it("getBlock encodes the height path segment", async () => {
    await getBlock(12345);
    expect(lastUrl(fetchMock)).toContain("/blocks/12345");
  });

  it("getLatestBlock hits the latest path", async () => {
    await getLatestBlock();
    expect(lastUrl(fetchMock)).toContain("/blocks/latest");
  });

  it("getTransactions builds an empty query with no params", async () => {
    await getTransactions();
    expect(lastUrl(fetchMock)).toContain("/transactions?");
  });

  it.each([
    [{ page: 2 }, "page=2"],
    [{ limit: 25 }, "limit=25"],
    [{ sender: "aeth1x" }, "sender=aeth1x"],
    [{ recipient: "aeth1y" }, "recipient=aeth1y"],
    [{ block_height: 999 }, "block_height=999"],
    [{ tx_type: "transfer" }, "tx_type=transfer"],
  ])("getTransactions serializes %o", async (params, expected) => {
    await getTransactions(params);
    expect(lastUrl(fetchMock)).toContain(expected);
  });

  it("getTransactions combines multiple params", async () => {
    await getTransactions({ page: 1, limit: 5, sender: "aeth1z" });
    const url = lastUrl(fetchMock);
    expect(url).toContain("page=1");
    expect(url).toContain("limit=5");
    expect(url).toContain("sender=aeth1z");
  });

  it("getTransaction encodes the hash", async () => {
    await getTransaction("0xABC/DEF");
    expect(lastUrl(fetchMock)).toContain("/transactions/0xABC%2FDEF");
  });

  it.each([
    [{ status: "active" }, "status=active"],
    [{ page: 4 }, "page=4"],
    [{ limit: 100 }, "limit=100"],
  ])("getValidators serializes %o", async (params, expected) => {
    await getValidators(params);
    expect(lastUrl(fetchMock)).toContain(expected);
  });

  it("getValidator encodes the address", async () => {
    await getValidator("aeth1validator");
    expect(lastUrl(fetchMock)).toContain("/validators/aeth1validator");
  });

  it.each([
    [{ status: "pending" }, "status=pending"],
    [{ creator: "aeth1c" }, "creator=aeth1c"],
    [{ validator: "aeth1v" }, "validator=aeth1v"],
  ])("getJobs serializes %o", async (params, expected) => {
    await getJobs(params);
    expect(lastUrl(fetchMock)).toContain(expected);
  });

  it("getJob encodes the id", async () => {
    await getJob("job 1");
    expect(lastUrl(fetchMock)).toContain("/jobs/job%201");
  });

  it("submitJob POSTs a JSON body to /jobs", async () => {
    fetchMock.mockResolvedValue(ok({ success: true, data: { id: "j1" } }));
    await submitJob({
      model_hash: "0xm",
      input_hash: "0xi",
      proof_type: "zk",
      priority: 1,
      timeout: 60,
      max_payment: "100",
    });
    const url = lastUrl(fetchMock);
    const init = lastInit(fetchMock);
    expect(url).toContain("/jobs");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("model_hash");
  });

  it("getStakingInfo encodes the address", async () => {
    await getStakingInfo("aeth1staker");
    expect(lastUrl(fetchMock)).toContain("/staking/aeth1staker");
  });

  it("getStakingValidators hits the validators path", async () => {
    await getStakingValidators();
    expect(lastUrl(fetchMock)).toContain("/staking/validators");
  });

  it("getNetworkStats hits the network stats path", async () => {
    await getNetworkStats();
    expect(lastUrl(fetchMock)).toContain("/network/stats");
  });
});

describe("api auth token injection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(ok({ success: true, data: {} }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearApiAccessToken();
  });

  it("adds a Bearer Authorization header when a token is set", async () => {
    setApiAccessToken("secret-token");
    await getNetworkStats();
    const headers = lastInit(fetchMock).headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("omits Authorization when no token is set", async () => {
    clearApiAccessToken();
    await getNetworkStats();
    const headers = lastInit(fetchMock).headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("trims whitespace and treats a blank token as cleared", async () => {
    setApiAccessToken("   ");
    await getNetworkStats();
    const headers = lastInit(fetchMock).headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });
});

describe("api error handling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    clearApiAccessToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws with the server message on a non-ok response", async () => {
    fetchMock.mockResolvedValue(
      ok({ success: false, message: "forbidden" }, 403),
    );
    await expect(getNetworkStats()).rejects.toMatchObject({
      name: "ApiClientError",
      statusCode: 403,
    });
  });

  it("wraps a network failure as a connection error with status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(getNetworkStats()).rejects.toMatchObject({
      name: "ApiClientError",
      statusCode: 0,
    });
  });

  it("returns the parsed data envelope on success", async () => {
    fetchMock.mockResolvedValue(
      ok({ success: true, data: { block_height: 10 } }),
    );
    const res = await getNetworkStats();
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ block_height: 10 });
  });
});
