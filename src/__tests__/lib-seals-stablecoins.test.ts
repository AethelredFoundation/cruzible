import { describe, it, expect } from "vitest";

import {
  normalizeSealStatus,
  buildSealMetrics,
  shortenHash,
  formatTimestamp as formatSealTimestamp,
  formatRelativeTime as formatSealRelative,
  getSealCommitmentCoverage,
  type SealListItem,
} from "@/lib/seals";
import {
  formatStablecoinAmount,
  shortStablecoinHash,
} from "@/lib/stablecoinHistory";
import {
  getAssetId,
  isStablecoinEnabled,
  getEnabledStablecoins,
  getAllStablecoins,
  STABLECOIN_ASSETS,
  CCTP_DOMAINS,
} from "@/lib/constants";

describe("seals normalizeSealStatus", () => {
  it.each([
    ["active", "active"],
    ["SEAL_STATUS_ACTIVE", "active"],
    ["revoked", "revoked"],
    ["SEAL_STATUS_REVOKED", "revoked"],
    ["expired", "expired"],
    ["superseded", "superseded"],
    ["SEAL_STATUS_SUPERSEDED", "superseded"],
    ["nonsense", "unknown"],
    ["", "unknown"],
    [null, "unknown"],
    [undefined, "unknown"],
    [42, "unknown"],
  ])("normalizeSealStatus(%s) === %s", (input, expected) => {
    expect(normalizeSealStatus(input)).toBe(expected);
  });
});

describe("seals buildSealMetrics", () => {
  function seal(overrides: Partial<SealListItem> = {}): SealListItem {
    return {
      id: "seal-1",
      jobId: "job-1",
      status: "active",
      modelCommitment: "0xmodel",
      inputCommitment: "0xinput",
      outputCommitment: "0xoutput",
      requester: "aeth1req",
      validatorCount: 10,
      createdAt: "2026-07-01T00:00:00Z",
      expiresAt: null,
      ...overrides,
    };
  }

  it("returns zeros for an empty set", () => {
    const m = buildSealMetrics([]);
    expect(m.activeCount).toBe(0);
    expect(m.revokedOrSupersededCount).toBe(0);
    expect(m.expiringSoonCount).toBe(0);
    expect(m.averageValidatorQuorum).toBe(0);
    expect(m.commitmentCoverage).toBe(0);
  });

  it("counts active and revoked/superseded seals", () => {
    const m = buildSealMetrics([
      seal({ status: "active" }),
      seal({ status: "revoked" }),
      seal({ status: "superseded" }),
      seal({ status: "expired" }),
    ]);
    expect(m.activeCount).toBe(1);
    expect(m.revokedOrSupersededCount).toBe(2);
  });

  it("averages the validator quorum", () => {
    const m = buildSealMetrics([
      seal({ validatorCount: 10 }),
      seal({ validatorCount: 20 }),
    ]);
    expect(m.averageValidatorQuorum).toBe(15);
  });

  it("computes commitment coverage as a percentage of fully-committed seals", () => {
    const m = buildSealMetrics([
      seal(),
      seal({ modelCommitment: "", inputCommitment: "", outputCommitment: "" }),
    ]);
    expect(m.commitmentCoverage).toBe(50);
  });

  it("counts seals expiring within 7 days", () => {
    const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
    const later = new Date(Date.now() + 30 * 86400_000).toISOString();
    const past = new Date(Date.now() - 86400_000).toISOString();
    const m = buildSealMetrics([
      seal({ expiresAt: soon }),
      seal({ expiresAt: later }),
      seal({ expiresAt: past }),
      seal({ expiresAt: null }),
    ]);
    expect(m.expiringSoonCount).toBe(1);
  });
});

describe("seals shortenHash", () => {
  it.each([
    ["", "n/a"],
    ["short", "short"],
  ])("shortenHash(%s) === %s", (input, expected) => {
    expect(shortenHash(input)).toBe(expected);
  });

  it("shortens a long hash with defaults", () => {
    const h = "0x" + "a".repeat(40);
    expect(shortenHash(h)).toBe(`${h.slice(0, 8)}...${h.slice(-6)}`);
  });

  it("respects custom start/end", () => {
    expect(shortenHash("abcdefghijklmnop", 4, 4)).toBe("abcd...mnop");
  });
});

describe("seals formatTimestamp / formatRelativeTime", () => {
  it.each([null, undefined, "", "bad"])("timestamp returns n/a for %s", (v) => {
    expect(formatSealTimestamp(v as string | null | undefined)).toBe("n/a");
  });

  it("timestamp formats a valid date", () => {
    expect(formatSealTimestamp("2026-07-12T00:00:00Z")).not.toBe("n/a");
  });

  it.each([null, undefined, "", "bad"])("relative returns n/a for %s", (v) => {
    expect(formatSealRelative(v as string | null | undefined)).toBe("n/a");
  });

  it("relative describes minutes/hours/days", () => {
    expect(
      formatSealRelative(new Date(Date.now() - 2 * 60_000).toISOString()),
    ).toMatch(/min/);
    expect(
      formatSealRelative(new Date(Date.now() - 5 * 3600_000).toISOString()),
    ).toMatch(/hour/);
    expect(
      formatSealRelative(new Date(Date.now() - 5 * 86400_000).toISOString()),
    ).toMatch(/day/);
  });
});

describe("seals getSealCommitmentCoverage", () => {
  it.each([
    [
      { modelCommitment: "a", inputCommitment: "b", outputCommitment: "c" },
      100,
    ],
    [{ modelCommitment: "a", inputCommitment: "b", outputCommitment: "" }, 67],
    [{ modelCommitment: "a", inputCommitment: "", outputCommitment: "" }, 33],
    [{ modelCommitment: "", inputCommitment: "", outputCommitment: "" }, 0],
  ])("coverage %o === %d", (commitments, expected) => {
    expect(
      getSealCommitmentCoverage(commitments as unknown as SealListItem),
    ).toBe(expected);
  });
});

describe("stablecoinHistory formatStablecoinAmount", () => {
  it.each([
    ["1000000", 6, "1"],
    ["1500000", 6, "1.5"],
    ["1234560", 6, "1.23456"],
    ["0", 6, "0"],
    ["1000000000000000000", 18, "1"],
  ])("formatStablecoinAmount(%s, %d) === %s", (amount, decimals, expected) => {
    expect(formatStablecoinAmount(amount, decimals)).toBe(expected);
  });

  it("returns unavailable for an unparseable amount", () => {
    expect(formatStablecoinAmount("not-a-number", 6)).toBe("unavailable");
  });

  it("trims trailing zeros but keeps significant decimals", () => {
    expect(formatStablecoinAmount("1200000", 6)).toBe("1.2");
  });
});

describe("stablecoinHistory shortStablecoinHash", () => {
  it("returns short values unchanged", () => {
    expect(shortStablecoinHash("0x1234")).toBe("0x1234");
  });

  it("shortens long hashes", () => {
    const h = "0x" + "b".repeat(40);
    expect(shortStablecoinHash(h)).toBe(`${h.slice(0, 8)}...${h.slice(-6)}`);
  });

  it("returns 14-char value unchanged (boundary)", () => {
    const v = "0x123456789012"; // 14 chars
    expect(shortStablecoinHash(v)).toBe(v);
  });
});

describe("constants stablecoin registry", () => {
  it("getAssetId is deterministic keccak of the symbol", () => {
    expect(getAssetId("USDC")).toBe(getAssetId("USDC"));
    expect(getAssetId("USDC")).not.toBe(getAssetId("USDT"));
    expect(getAssetId("USDC")).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("isStablecoinEnabled is true only for ACTIVE phase", () => {
    expect(isStablecoinEnabled(STABLECOIN_ASSETS.USDC)).toBe(false);
    expect(isStablecoinEnabled(STABLECOIN_ASSETS.USDT)).toBe(false);
  });

  it("getEnabledStablecoins returns only ACTIVE assets", () => {
    const enabled = getEnabledStablecoins();
    expect(enabled.map((a) => a.symbol)).not.toContain("USDC");
    expect(enabled.map((a) => a.symbol)).not.toContain("USDT");
  });

  it("getAllStablecoins returns every registered asset", () => {
    expect(
      getAllStablecoins()
        .map((a) => a.symbol)
        .sort(),
    ).toEqual(["USDC", "USDT"]);
  });

  it("each registered asset carries a stable assetId matching getAssetId", () => {
    expect(STABLECOIN_ASSETS.USDC.assetId).toBe(getAssetId("USDC"));
    expect(STABLECOIN_ASSETS.USDT.assetId).toBe(getAssetId("USDT"));
  });

  it("CCTP domains match canonical Circle domain ids", () => {
    expect(CCTP_DOMAINS.ETHEREUM).toBe(0);
    expect(CCTP_DOMAINS.BASE).toBe(6);
    expect(CCTP_DOMAINS.POLYGON).toBe(7);
  });
});
