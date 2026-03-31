/**
 * Utility Function Tests
 */

import {
  formatFullNumber,
  formatNumber,
  seededAddress,
  seededHex,
  seededInt,
  seededRandom,
  seededRange,
  truncateAddress,
} from "@/lib/utils";

describe("seededRandom", () => {
  it("is deterministic for the same seed", () => {
    expect(seededRandom(42)).toBe(seededRandom(42));
  });

  it("returns a value in the [0, 1) range", () => {
    const result = seededRandom(42);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(1);
  });
});

describe("seededRange", () => {
  it("stays within the requested range", () => {
    const result = seededRange(42, 10, 20);
    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThan(20);
  });
});

describe("seededInt", () => {
  it("returns a deterministic integer within the inclusive range", () => {
    const result = seededInt(42, 1, 5);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(5);
    expect(result).toBe(seededInt(42, 1, 5));
  });
});

describe("seededHex", () => {
  it("returns a deterministic hex string of the requested length", () => {
    const result = seededHex(42, 12);
    expect(result).toHaveLength(12);
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result).toBe(seededHex(42, 12));
  });
});

describe("seededAddress", () => {
  it("returns an aethelred-style deterministic address", () => {
    const result = seededAddress(42);
    expect(result).toMatch(/^aeth1[a-z0-9]{38}$/);
    expect(result).toBe(seededAddress(42));
  });
});

describe("formatNumber", () => {
  it("formats large numbers with compact suffixes", () => {
    expect(formatNumber(1_000_000)).toBe("1.0M");
    expect(formatNumber(1_234_567_890)).toBe("1.23B");
  });

  it("formats decimal thousands using compact notation", () => {
    expect(formatNumber(1234.5678, 2)).toBe("1.23K");
    expect(formatNumber(1234.5, 4)).toBe("1.2345K");
  });

  it("handles zero and negative numbers", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-1_000_000)).toBe("-1,000,000");
  });
});

describe("formatFullNumber", () => {
  it("formats numbers with locale separators", () => {
    expect(formatFullNumber(1_000_000)).toBe("1,000,000");
    expect(formatFullNumber(1234.567)).toBe("1,234.567");
  });
});

describe("truncateAddress", () => {
  it("truncates long addresses", () => {
    const address = "aethelred1abcdefghijklmnopqrstuvwxyz";
    expect(truncateAddress(address, 6, 4)).toBe("aethel...wxyz");
  });

  it("returns short addresses unchanged", () => {
    expect(truncateAddress("short")).toBe("short");
  });
});
