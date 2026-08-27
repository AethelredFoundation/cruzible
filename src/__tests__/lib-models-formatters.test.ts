import { describe, it, expect } from "vitest";

import {
  formatModelCategory,
  truncateIdentifier,
  formatDateTime,
  formatRelativeTime,
  formatPercent,
  formatNullableNumber,
  formatBytes,
  prettyPrintSchema,
} from "@/lib/models";

describe("models formatModelCategory", () => {
  it.each([
    ["UTILITY_CATEGORY_VISION", "Vision"],
    ["UTILITY_CATEGORY_LANGUAGE", "Language"],
    ["VISION", "Vision"],
    ["A", "A"],
  ])("formatModelCategory(%s) === %s", (input, expected) => {
    expect(formatModelCategory(input)).toBe(expected);
  });
});

describe("models truncateIdentifier", () => {
  it("returns dash for empty input", () => {
    expect(truncateIdentifier("")).toBe("-");
  });

  it("returns short values unchanged", () => {
    expect(truncateIdentifier("short")).toBe("short");
  });

  it("truncates long identifiers with default prefix/suffix", () => {
    const id = "0x" + "a".repeat(40);
    expect(truncateIdentifier(id)).toBe(`${id.slice(0, 10)}...${id.slice(-8)}`);
  });

  it("respects custom prefix/suffix", () => {
    const id = "abcdefghijklmnopqrstuvwxyz";
    expect(truncateIdentifier(id, 4, 4)).toBe("abcd...wxyz");
  });

  it("returns the value unchanged at the exact boundary", () => {
    const boundary = "x".repeat(10 + 8 + 3);
    expect(truncateIdentifier(boundary)).toBe(boundary);
  });
});

describe("models formatDateTime", () => {
  it.each([null, undefined, "", "not-a-date"])(
    "returns Unpublished for %s",
    (value) => {
      expect(formatDateTime(value as string | null | undefined)).toBe(
        "Unpublished",
      );
    },
  );

  it("formats a valid ISO date", () => {
    const out = formatDateTime("2026-07-12T10:30:00Z");
    expect(out).not.toBe("Unpublished");
    expect(out).toMatch(/2026/);
  });
});

describe("models formatRelativeTime", () => {
  it.each([null, undefined, "", "garbage"])(
    "returns Unpublished for %s",
    (value) => {
      expect(formatRelativeTime(value as string | null | undefined)).toBe(
        "Unpublished",
      );
    },
  );

  it("describes a recent past time in minutes", () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(formatRelativeTime(twoMinAgo)).toMatch(/minute|min/);
  });

  it("describes hours, days, months, years for larger deltas", () => {
    expect(
      formatRelativeTime(new Date(Date.now() - 3 * 3600_000).toISOString()),
    ).toMatch(/hour/);
    expect(
      formatRelativeTime(new Date(Date.now() - 3 * 86400_000).toISOString()),
    ).toMatch(/day/);
    expect(
      formatRelativeTime(new Date(Date.now() - 60 * 86400_000).toISOString()),
    ).toMatch(/month/);
    expect(
      formatRelativeTime(new Date(Date.now() - 400 * 86400_000).toISOString()),
    ).toMatch(/year/);
  });
});

describe("models formatPercent", () => {
  it.each<[number | null | undefined, string]>([
    [null, "Unpublished"],
    [undefined, "Unpublished"],
    [Number.NaN, "Unpublished"],
  ])("returns fallback for %s", (value) => {
    expect(formatPercent(value as number | null | undefined)).toBe(
      "Unpublished",
    );
  });

  it.each([
    [50, 1, "50.0%"],
    [33.333, 2, "33.33%"],
    [100, 0, "100%"],
    [0, 1, "0.0%"],
  ])("formatPercent(%s, %s) === %s", (value, digits, expected) => {
    expect(formatPercent(value, digits)).toBe(expected);
  });

  it("honors a custom fallback", () => {
    expect(formatPercent(null, 1, "N/A")).toBe("N/A");
  });
});

describe("models formatNullableNumber", () => {
  it.each([null, undefined, Number.NaN])("returns fallback for %s", (value) => {
    expect(formatNullableNumber(value as number | null | undefined)).toBe(
      "Unpublished",
    );
  });

  it("locale-formats a real number", () => {
    expect(formatNullableNumber(1234567)).toBe((1234567).toLocaleString());
  });

  it("honors a custom fallback", () => {
    expect(formatNullableNumber(null, "-")).toBe("-");
  });
});

describe("models formatBytes", () => {
  it.each([null, undefined, ""])("returns fallback for %s", (value) => {
    expect(formatBytes(value as string | null | undefined)).toBe("Unpublished");
  });

  it("returns the raw value when non-numeric", () => {
    expect(formatBytes("abc")).toBe("abc");
  });

  it.each([
    ["0", "0 B"],
    ["512", "512 B"],
    ["1024", "1.0 KB"],
    ["1048576", "1.0 MB"],
    ["1073741824", "1.0 GB"],
    ["1099511627776", "1.0 TB"],
  ])("formatBytes(%s) === %s", (value, expected) => {
    expect(formatBytes(value)).toBe(expected);
  });

  it("uses 0 decimals when the scaled size is >= 10", () => {
    expect(formatBytes(String(15 * 1024))).toBe("15 KB");
  });

  it("caps at TB for very large values", () => {
    expect(formatBytes(String(5 * 1024 ** 4))).toBe("5.0 TB"); // 5.0 < 10 -> 1 decimal
    expect(formatBytes(String(50 * 1024 ** 4))).toBe("50 TB"); // >= 10 -> 0 decimals
  });
});

describe("models prettyPrintSchema", () => {
  it("returns a placeholder for empty schema", () => {
    expect(prettyPrintSchema("")).toBe("Schema not published");
  });

  it("pretty-prints valid JSON with 2-space indent", () => {
    expect(prettyPrintSchema('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("returns the raw string when not valid JSON", () => {
    expect(prettyPrintSchema("not json")).toBe("not json");
  });
});
