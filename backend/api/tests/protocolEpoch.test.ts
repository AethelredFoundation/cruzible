import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const currentEpochMock = vi.hoisted(() => vi.fn());
const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("ethers", () => ({
  Contract: vi.fn(() => ({
    currentEpoch: currentEpochMock,
  })),
  JsonRpcProvider: vi.fn(),
}));

vi.mock("../src/utils/logger", () => ({
  logger: loggerMocks,
}));

const originalEnv = { ...process.env };

describe("resolveProtocolEpoch", () => {
  beforeEach(() => {
    vi.resetModules();
    currentEpochMock.mockReset();
    loggerMocks.error.mockClear();
    loggerMocks.info.mockClear();
    loggerMocks.warn.mockClear();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      CRUZIBLE_VAULT_ADDRESS: "0x1111111111111111111111111111111111111111",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("keeps provider failure details out of public epoch fallback warnings", async () => {
    currentEpochMock.mockRejectedValue(
      new Error(
        "dial tcp secret-rpc.internal:26657 via redis://:secret@cache refused",
      ),
    );
    const blockchainService = {
      getLatestHeight: vi.fn().mockResolvedValue(321),
    };

    const { resolveProtocolEpoch } = await import("../src/lib/protocolEpoch");
    const result = await resolveProtocolEpoch({ blockchainService });
    const serializedResult = JSON.stringify(result);

    expect(result).toEqual({
      epoch: 321,
      source: "rpc/tendermint.latestHeight (fallback)",
      warning:
        "Failed to query currentEpoch from vault contract; falling back to chain height",
    });
    expect(serializedResult).not.toContain("secret-rpc.internal");
    expect(serializedResult).not.toContain("secret@cache");
    expect(loggerMocks.error).toHaveBeenCalledWith(
      "Failed to query currentEpoch from vault contract",
      { error: expect.any(Error) },
    );
  });
});
