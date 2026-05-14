/**
 * Utility Function Tests
 */

import {
  formatFullNumber,
  formatNumber,
  getSafeExternalUrl,
  getTrustedModelStorageUrl,
  isHttpUrl,
  truncateAddress,
} from "@/lib/utils";

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

describe("isHttpUrl", () => {
  it("allows only http and https URLs", () => {
    expect(isHttpUrl("https://validator.example")).toBe(true);
    expect(isHttpUrl("http://validator.example")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("getSafeExternalUrl", () => {
  it("allows only public HTTPS hostname URLs", () => {
    expect(getSafeExternalUrl("https://validator.cruzible.org")).toBe(
      "https://validator.cruzible.org/",
    );
    expect(getSafeExternalUrl("http://validator.cruzible.org")).toBe(null);
    expect(getSafeExternalUrl("https://validator.example")).toBe(null);
    expect(getSafeExternalUrl("https://validator.localhost")).toBe(null);
    expect(getSafeExternalUrl("https://127.0.0.1/status")).toBe(null);
    expect(getSafeExternalUrl("https://203.0.113.10/status")).toBe(null);
    expect(getSafeExternalUrl("https://10.0.0.5/status")).toBe(null);
    expect(getSafeExternalUrl("https://[::1]/status")).toBe(null);
    expect(getSafeExternalUrl("https://[fd00::1]/status")).toBe(null);
    expect(getSafeExternalUrl("https://user:pass@validator.cruzible.org")).toBe(
      null,
    );
    expect(getSafeExternalUrl("javascript:alert(1)")).toBe(null);
    expect(getSafeExternalUrl("not a url")).toBe(null);
  });
});

describe("getTrustedModelStorageUrl", () => {
  it("allows only trusted model storage gateways", () => {
    expect(getTrustedModelStorageUrl("https://ipfs.io/ipfs/bafy123")).toBe(
      "https://ipfs.io/ipfs/bafy123",
    );
    expect(getTrustedModelStorageUrl("https://arweave.net/tx123")).toBe(
      "https://arweave.net/tx123",
    );
    expect(getTrustedModelStorageUrl("https://example.com/model.json")).toBe(
      null,
    );
    expect(getTrustedModelStorageUrl("http://ipfs.io/ipfs/bafy123")).toBe(null);
    expect(getTrustedModelStorageUrl("https://ipfs.io/not-ipfs/bafy123")).toBe(
      null,
    );
    expect(
      getTrustedModelStorageUrl("https://user:pass@ipfs.io/ipfs/bafy123"),
    ).toBe(null);
  });

  it("normalizes decentralized storage schemes to trusted gateways", () => {
    expect(getTrustedModelStorageUrl("ipfs://bafy123/model.json")).toBe(
      "https://ipfs.io/ipfs/bafy123/model.json",
    );
    expect(getTrustedModelStorageUrl("ar://tx123")).toBe(
      "https://arweave.net/tx123",
    );
  });
});
