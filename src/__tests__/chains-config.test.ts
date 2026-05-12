import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function importChainsConfig() {
  vi.resetModules();
  return import("@/config/chains");
}

function resetChainEnv() {
  process.env = { ...originalEnv };
  delete process.env.NEXT_PUBLIC_CHAIN_ENV;
}

describe("chain config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetChainEnv();
    vi.resetModules();
  });

  it("defaults to testnet outside production when no chain env is set", async () => {
    vi.stubEnv("NODE_ENV", "test");

    const { activeChain, AETHELRED_TESTNET_ID, CHAIN_ENV } =
      await importChainsConfig();

    expect(CHAIN_ENV).toBe("testnet");
    expect(activeChain.id).toBe(AETHELRED_TESTNET_ID);
  });

  it("requires an explicit chain env in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(importChainsConfig()).rejects.toThrow(
      "NEXT_PUBLIC_CHAIN_ENV is required in production",
    );
  });

  it("rejects unsupported chain env values instead of defaulting", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "staging";

    await expect(importChainsConfig()).rejects.toThrow(
      "NEXT_PUBLIC_CHAIN_ENV must be one of mainnet, testnet, or devnet",
    );
  });

  it("selects the configured production chain explicitly", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "mainnet";

    const { activeChain, AETHELRED_MAINNET_ID, CHAIN_ENV } =
      await importChainsConfig();

    expect(CHAIN_ENV).toBe("mainnet");
    expect(activeChain.id).toBe(AETHELRED_MAINNET_ID);
  });
});
