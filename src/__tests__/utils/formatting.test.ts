/**
 * Utility Function Tests
 */

import {
  formatNumber,
  truncateAddress,
  formatDate,
  formatDuration,
  calculatePercentage,
  shortenHash,
  parseAmount,
  formatAmount,
} from "@/lib/utils";

describe("formatNumber", () => {
  it("formats billions with compact notation", () => {
    expect(formatNumber(1234567890)).toBe("1.23B");
  });

  it("formats millions with compact notation", () => {
    expect(formatNumber(1000000)).toBe("1.0M");
    expect(formatNumber(2500000)).toBe("2.5M");
  });

  it("formats thousands with compact notation", () => {
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(1000)).toBe("1.0K");
  });

  it("formats sub-thousand numbers with commas", () => {
    expect(formatNumber(999)).toBe("999");
  });

  it("formats decimal numbers below 1000", () => {
    expect(formatNumber(123.4567, 2)).toBe("123.46");
  });

  it("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("respects explicit decimals for millions", () => {
    expect(formatNumber(1234567, 2)).toBe("1.23M");
  });
});

describe("truncateAddress", () => {
  it("truncates long addresses", () => {
    const address = "aethelred1abcdefghijklmnopqrstuvwxyz";
    expect(truncateAddress(address, 6, 4)).toBe("aethel...wxyz");
  });

  it("returns short addresses unchanged", () => {
    const address = "short";
    expect(truncateAddress(address)).toBe("short");
  });

  it("uses default start and end lengths", () => {
    const address = "aethelred1validatoraddress123456";
    const result = truncateAddress(address);
    expect(result).toContain("...");
  });
});

describe("formatDate", () => {
  it("formats ISO date string", () => {
    const date = "2024-03-07T12:00:00Z";
    expect(formatDate(date)).toBeDefined();
  });

  it("formats Date object", () => {
    const date = new Date("2024-03-07T12:00:00Z");
    expect(formatDate(date)).toBeDefined();
  });

  it("handles timestamp", () => {
    const timestamp = 1709812800000;
    expect(formatDate(timestamp)).toBeDefined();
  });
});

describe("formatDuration", () => {
  it("formats seconds to human readable", () => {
    expect(formatDuration(30)).toBe("30 seconds");
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(90)).toBe("1 minute 30 seconds");
  });

  it("formats hours", () => {
    expect(formatDuration(3600)).toBe("1 hour");
    expect(formatDuration(7200)).toBe("2 hours");
  });

  it("formats days", () => {
    expect(formatDuration(86400)).toBe("1 day");
    expect(formatDuration(172800)).toBe("2 days");
  });

  it("formats complex durations", () => {
    expect(formatDuration(90061)).toBe("1 day 1 hour 1 minute 1 second");
  });
});

describe("calculatePercentage", () => {
  it("calculates percentage correctly", () => {
    expect(calculatePercentage(50, 100)).toBe(50);
    expect(calculatePercentage(25, 100)).toBe(25);
  });

  it("handles zero total", () => {
    expect(calculatePercentage(50, 0)).toBe(0);
  });

  it("handles values greater than total", () => {
    expect(calculatePercentage(150, 100)).toBe(150);
  });
});

describe("shortenHash", () => {
  it("shortens long hashes", () => {
    const hash = "0x" + "a".repeat(64);
    expect(shortenHash(hash)).toBe("0xaaaa...aaaa");
  });

  it("returns short hashes unchanged", () => {
    const hash = "0x1234";
    expect(shortenHash(hash)).toBe("0x1234");
  });
});

describe("parseAmount", () => {
  it("parses string amount", () => {
    expect(parseAmount("1000000")).toBe(1000000);
    expect(parseAmount("1000000.5")).toBe(1000000.5);
  });

  it("parses number amount", () => {
    expect(parseAmount(1000000)).toBe(1000000);
  });

  it("handles scientific notation", () => {
    expect(parseAmount("1e6")).toBe(1000000);
  });
});

describe("formatAmount", () => {
  it("formats with default decimals", () => {
    expect(formatAmount(1000000, 6)).toBe("1.000000");
  });

  it("formats large amounts", () => {
    expect(formatAmount(1000000000000, 6)).toBe("1000000.000000");
  });

  it("formats small amounts", () => {
    expect(formatAmount(1, 6)).toBe("0.000001");
  });
});
