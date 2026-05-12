import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiUrl, getApiV1BaseUrl } from "@/config/api";

const originalEnv = { ...process.env };

function resetPublicApiEnv() {
  process.env = { ...originalEnv };
  delete process.env.NEXT_PUBLIC_API_URL;
  delete process.env.NEXT_PUBLIC_CHAIN_ENV;
}

describe("frontend API config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetPublicApiEnv();
  });

  it("uses local API only outside production when unset", () => {
    vi.stubEnv("NODE_ENV", "test");

    expect(getApiV1BaseUrl()).toBe("http://localhost:3001/v1");
    expect(getApiUrl("/validators")).toBe(
      "http://localhost:3001/v1/validators",
    );
  });

  it("normalizes configured API origins to the v1 base", () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.NEXT_PUBLIC_API_URL = "https://api.testnet.aethelred.org/";

    expect(getApiV1BaseUrl()).toBe("https://api.testnet.aethelred.org/v1");
    expect(getApiUrl("models")).toBe(
      "https://api.testnet.aethelred.org/v1/models",
    );
  });

  it("requires an explicit API URL for production public-data requests", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL is required for production public-data requests",
    );
  });

  it("requires an explicit chain env for production public-data requests", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_API_URL = "https://api.testnet.aethelred.org";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_CHAIN_ENV is required in production",
    );
  });

  it("rejects credential-bearing API URLs", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
    process.env.NEXT_PUBLIC_API_URL =
      "https://user:pass@api.testnet.aethelred.org";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL must not include credentials",
    );
  });

  it("rejects API URLs with query strings or fragments", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
    process.env.NEXT_PUBLIC_API_URL =
      "https://api.testnet.aethelred.org?token=leak";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL must not include query strings or fragments",
    );
  });

  it("rejects API URLs outside the v1 root", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
    process.env.NEXT_PUBLIC_API_URL = "https://api.testnet.aethelred.org/admin";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL path must be empty or /v1",
    );
  });

  it("rejects non-local plaintext API URLs", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
    process.env.NEXT_PUBLIC_API_URL = "http://api.testnet.aethelred.org";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost",
    );
  });

  it("rejects mainnet API URLs when the wallet chain is not mainnet", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
    process.env.NEXT_PUBLIC_API_URL = "https://api.mainnet.aethelred.org";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL points at a mainnet API while NEXT_PUBLIC_CHAIN_ENV is not mainnet",
    );
  });

  it("rejects testnet API URLs for mainnet wallet builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "mainnet";
    process.env.NEXT_PUBLIC_API_URL = "https://api.testnet.aethelred.org";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL must not point at a testnet API when NEXT_PUBLIC_CHAIN_ENV=mainnet",
    );
  });

  it("rejects localhost API URLs outside devnet production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL must not point at localhost unless NEXT_PUBLIC_CHAIN_ENV=devnet",
    );
  });

  it("allows localhost API URLs for explicit devnet production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "devnet";
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001";

    expect(getApiV1BaseUrl()).toBe("http://localhost:3001/v1");
  });
});
