import { describe, it, expect } from "vitest";

import {
  getSafeExternalUrl,
  getTrustedModelStorageUrl,
  formatNumber,
  truncateAddress,
  isHttpUrl,
} from "@/lib/utils";

// Additional adversarial SSRF vectors for getSafeExternalUrl — this function
// guards outbound navigation, so the negative space matters most.
describe("getSafeExternalUrl — additional SSRF vectors", () => {
  it.each([
    "https://10.255.255.255", // private class A
    "https://172.16.0.1", // private class B literal
    "https://192.168.100.1", // private class C
    "https://169.254.169.254", // link-local / cloud metadata
    "https://0.0.0.0", // wildcard
    "https://255.255.255.255", // broadcast (ipv4 literal)
    "https://[fc00::1]", // ipv6 ULA
    "https://[fe80::abcd]", // ipv6 link-local
    "https://[2001:db8::1]", // ipv6 literal
    "http://example.com", // non-https
    "ftp://example.com", // non-https scheme
    "https://admin:secret@example.com", // credentials
    "https://foo.localhost", // reserved suffix
    "https://svc.internal.test", // reserved .test
  ])("blocks %s", (url) => {
    expect(getSafeExternalUrl(url)).toBeNull();
  });

  it.each([
    "https://example.com",
    "https://api.example.org/v1",
    "https://deep.sub.domain.example.co/path?x=1",
    "https://xn--nxasmq6b.co", // punycode host on a public TLD
  ])("allows public host %s", (url) => {
    expect(getSafeExternalUrl(url)).toBe(new URL(url).toString());
  });
});

describe("getTrustedModelStorageUrl — additional allowlist cases", () => {
  it.each([
    "https://ipfs.io/ipfs/QmABC123",
    "https://cloudflare-ipfs.com/ipfs/bafyxyz",
    "https://gateway.pinata.cloud/ipfs/QmZZZ",
    "https://arweave.net/abc-TX_id",
  ])("allows %s", (url) => {
    expect(getTrustedModelStorageUrl(url)).toBe(new URL(url).toString());
  });

  it.each([
    "https://ipfs.example.com/ipfs/QmABC", // lookalike host
    "https://ipfs.io/ipns/QmABC", // wrong namespace
    "https://arweave.net", // no tx path
    "ftp://ipfs.io/ipfs/QmABC", // wrong scheme
    "https://ipfs.io/ipfs", // no cid after prefix
  ])("blocks %s", (url) => {
    expect(getTrustedModelStorageUrl(url)).toBeNull();
  });

  it("normalizes ipfs:// and ar:// to https gateways", () => {
    expect(getTrustedModelStorageUrl("ipfs://QmABC/w.bin")).toBe(
      "https://ipfs.io/ipfs/QmABC/w.bin",
    );
    expect(getTrustedModelStorageUrl("ar://TX123")).toBe(
      "https://arweave.net/TX123",
    );
  });
});

describe("formatNumber — additional boundaries", () => {
  it.each([
    [999.4, 0, "999"],
    [1000.5, 0, "1.0K"],
    [1_499_999, 0, "1.5M"], // >= 1,000,000 -> M branch
    [1_500_000, 0, "1.5M"],
    [999_999_999, 0, "1000.0M"],
    [1_000_000_000, 0, "1.00B"],
    [999_000_000_000, 0, "999.00B"],
  ])("formatNumber(%d, %d) === %s", (input, decimals, expected) => {
    expect(formatNumber(input, decimals)).toBe(expected);
  });
});

describe("truncateAddress — additional cases", () => {
  it.each([
    ["0x0000000000000000000000000000000000000000", "0x00000000...000000"],
    ["aeth1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", "aeth1qqqqq...qqqqqq"],
  ])("truncates %s -> %s", (input, expected) => {
    expect(truncateAddress(input)).toBe(expected);
  });

  it.each([
    [4, 4],
    [8, 8],
    [2, 2],
  ])("respects custom start=%d end=%d", (start, end) => {
    const addr = "0x" + "a".repeat(40);
    const out = truncateAddress(addr, start, end);
    expect(out.startsWith(addr.slice(0, start))).toBe(true);
    expect(out.endsWith(addr.slice(-end))).toBe(true);
  });
});

describe("isHttpUrl — additional cases", () => {
  it.each([
    ["HTTPS://EXAMPLE.COM", true],
    ["https://example.com:8443/x", true],
    ["mailto:a@b.com", false],
    ["data:text/plain;base64,AA==", false],
    ["//protocol-relative", false],
    ["  https://spaced.com  ", true], // URL() trims surrounding whitespace
  ])("isHttpUrl(%s) === %s", (input, expected) => {
    expect(isHttpUrl(input)).toBe(expected);
  });
});
