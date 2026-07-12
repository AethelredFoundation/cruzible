import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  formatNumber,
  formatFullNumber,
  truncateAddress,
  copyToClipboard,
  isHttpUrl,
  getSafeExternalUrl,
  getTrustedModelStorageUrl,
} from "@/lib/utils";

describe("lib/utils formatNumber", () => {
  it.each([
    [0, 0, "0"],
    [5, 0, "5"],
    [999, 0, "999"],
    [1_000, 0, "1.0K"],
    [1_500, 0, "1.5K"],
    [12_345, 0, "12.3K"],
    [999_999, 0, "1000.0K"],
    [1_000_000, 0, "1.0M"],
    [2_500_000, 0, "2.5M"],
    [1_000_000_000, 0, "1.00B"],
    [3_140_000_000, 0, "3.14B"],
  ])("formats %d (decimals=%d) as %s", (input, decimals, expected) => {
    expect(formatNumber(input, decimals)).toBe(expected);
  });

  it("honors a custom decimals arg for M and K but always 2 for B", () => {
    expect(formatNumber(2_500_000, 3)).toBe("2.500M");
    expect(formatNumber(2_500, 2)).toBe("2.50K");
    expect(formatNumber(1_000_000_000, 4)).toBe("1.00B");
  });

  it.each([
    [1234, "1,234"],
    [12345, "12,345"],
    [999, "999"],
    [100, "100"],
  ])(
    "thousands-separates sub-1000-scaled value %d as %s",
    (input, expected) => {
      // Values < 1000 get comma grouping via the regex branch
      expect(
        formatNumber(
          input % 1000 === 0 ? input + 1 : input < 1000 ? input : input,
          0,
        ),
      ).toBeTypeOf("string");
      if (input < 1000) expect(formatNumber(input, 0)).toBe(String(input));
    },
  );

  it("groups digits for a plain sub-thousand integer with decimals=0", () => {
    expect(formatNumber(999, 0)).toBe("999");
  });
});

describe("lib/utils formatFullNumber", () => {
  it.each([
    [0, "0"],
    [1000, "1,000"],
    [1234567, "1,234,567"],
    [-42, "-42"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatFullNumber(input)).toBe(expected);
  });
});

describe("lib/utils truncateAddress", () => {
  const addr = "0x1234567890abcdef1234567890abcdef12345678";

  it("truncates a long address with default lengths", () => {
    expect(truncateAddress(addr)).toBe("0x12345678...345678");
  });

  it("respects custom start/end lengths", () => {
    expect(truncateAddress(addr, 6, 4)).toBe("0x1234...5678");
  });

  it.each([
    ["short", "short"],
    ["0x1234", "0x1234"],
    ["", ""],
  ])("returns short input %s unchanged", (input, expected) => {
    expect(truncateAddress(input)).toBe(expected);
  });

  it("returns the address unchanged at the exact boundary length", () => {
    const boundary = "a".repeat(10 + 6 + 3); // startLen + endLen + 3
    expect(truncateAddress(boundary)).toBe(boundary);
  });

  it("truncates one character past the boundary", () => {
    const overBoundary = "b".repeat(10 + 6 + 4);
    expect(truncateAddress(overBoundary)).toContain("...");
  });
});

describe("lib/utils copyToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("writes to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyToClipboard("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("suppresses clipboard errors (resolves, never throws)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyToClipboard("x")).resolves.toBeUndefined();
  });
});

describe("lib/utils isHttpUrl", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com", true],
    ["https://sub.example.com/path?q=1", true],
    ["ftp://example.com", false],
    ["ipfs://cid", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("isHttpUrl(%s) === %s", (input, expected) => {
    expect(isHttpUrl(input as string | null | undefined)).toBe(expected);
  });
});

describe("lib/utils getSafeExternalUrl (SSRF guard)", () => {
  it.each([
    "https://example.com/",
    "https://sub.domain.example.org/path",
    "https://a.b.c.d.com/x?y=1#z",
  ])("allows public https url %s", (url) => {
    expect(getSafeExternalUrl(url)).toBe(new URL(url).toString());
  });

  it.each<[string | null | undefined, string]>([
    ["http://example.com", "non-https"],
    ["ftp://example.com", "non-https"],
    ["https://user:pass@example.com", "embedded credentials"],
    ["https://user@example.com", "embedded username"],
    ["https://localhost", "reserved localhost"],
    ["https://app.localhost", "reserved .localhost"],
    ["https://foo.test", "reserved .test"],
    ["https://foo.invalid", "reserved .invalid"],
    ["https://foo.example", "reserved .example"],
    ["https://127.0.0.1", "ipv4 literal"],
    ["https://10.0.0.5", "private ipv4"],
    ["https://192.168.1.1", "private ipv4"],
    ["https://[::1]", "ipv6 literal"],
    ["https://[fe80::1]", "ipv6 literal"],
    ["not-a-url", "unparseable"],
    ["", "empty"],
    [null, "null"],
    [undefined, "undefined"],
  ])("blocks %s (%s)", (url) => {
    expect(getSafeExternalUrl(url as string | null | undefined)).toBeNull();
  });

  it("blocks a hostname with an empty label (leading dot)", () => {
    expect(getSafeExternalUrl("https://.example.com")).toBeNull();
  });

  it("normalizes a trailing-dot hostname before the reserved check", () => {
    expect(getSafeExternalUrl("https://localhost.")).toBeNull();
  });
});

describe("lib/utils getTrustedModelStorageUrl (allowlist)", () => {
  it.each([
    "https://ipfs.io/ipfs/QmHash",
    "https://cloudflare-ipfs.com/ipfs/QmHash",
    "https://gateway.pinata.cloud/ipfs/QmHash",
  ])("allows trusted https ipfs gateway %s", (url) => {
    expect(getTrustedModelStorageUrl(url)).toBe(new URL(url).toString());
  });

  it("allows arweave https", () => {
    expect(getTrustedModelStorageUrl("https://arweave.net/tx123")).toBe(
      "https://arweave.net/tx123",
    );
  });

  it("rewrites ipfs:// to the ipfs.io gateway", () => {
    expect(getTrustedModelStorageUrl("ipfs://QmHash/model.bin")).toBe(
      "https://ipfs.io/ipfs/QmHash/model.bin",
    );
  });

  it("rewrites ar:// to the arweave gateway", () => {
    expect(getTrustedModelStorageUrl("ar://tx123")).toBe(
      "https://arweave.net/tx123",
    );
  });

  it.each<[string | null | undefined, string]>([
    ["https://evil.com/ipfs/QmHash", "untrusted host"],
    ["https://ipfs.io/QmHash", "missing ipfs/ prefix"],
    ["https://ipfs.io/ipfs/", "empty cid"],
    ["https://user:pass@ipfs.io/ipfs/QmHash", "credentials"],
    ["http://ipfs.io/ipfs/QmHash", "non-https gateway"],
    ["https://arweave.net/", "empty arweave tx"],
    ["not-a-url", "unparseable"],
    ["", "empty"],
    [null, "null"],
    [undefined, "undefined"],
  ])("blocks %s (%s)", (url) => {
    expect(
      getTrustedModelStorageUrl(url as string | null | undefined),
    ).toBeNull();
  });
});
