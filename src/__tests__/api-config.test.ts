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

  it("rejects mainnet API URLs when the wallet chain is not mainnet", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
    process.env.NEXT_PUBLIC_API_URL = "https://api.mainnet.aethelred.org";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL points at a mainnet API while NEXT_PUBLIC_CHAIN_ENV is not mainnet",
    );
  });

  it("rejects local or testnet API URLs for mainnet wallet builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "mainnet";
    process.env.NEXT_PUBLIC_API_URL = "https://api.testnet.aethelred.org";

    expect(() => getApiV1BaseUrl()).toThrow(
      "NEXT_PUBLIC_API_URL must not point at a testnet or local API when NEXT_PUBLIC_CHAIN_ENV=mainnet",
    );
  });
});
