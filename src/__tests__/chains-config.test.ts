import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const FULL_SUITE_TIMEOUT_MS = 15000;

async function importChainsConfig() {
  vi.resetModules();
  return import("@/config/chains");
}

function resetChainEnv() {
  process.env = { ...originalEnv };
  delete process.env.NEXT_PUBLIC_CHAIN_ENV;
  delete process.env.NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID;
  delete process.env.NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL;
  delete process.env.NEXT_PUBLIC_AETHELRED_MAINNET_EXPLORER_URL;
  delete process.env.NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL;
  delete process.env.NEXT_PUBLIC_AETHELRED_GENESIS_HASH;
}

describe("chain config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetChainEnv();
    vi.resetModules();
  });

  it(
    "defaults to testnet outside production when no chain env is set",
    async () => {
      vi.stubEnv("NODE_ENV", "test");

      const { activeChain, AETHELRED_TESTNET_ID, CHAIN_ENV } =
        await importChainsConfig();

      expect(CHAIN_ENV).toBe("testnet");
      expect(activeChain.id).toBe(AETHELRED_TESTNET_ID);
    },
    FULL_SUITE_TIMEOUT_MS,
  );

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
    process.env.NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID = "7333";
    process.env.NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL =
      "https://rpc.mainnet.example.org";
    process.env.NEXT_PUBLIC_AETHELRED_MAINNET_EXPLORER_URL =
      "https://explorer.mainnet.example.org";
    process.env.NEXT_PUBLIC_AETHELRED_GENESIS_HASH = `0x${"a".repeat(64)}`;

    const { activeChain, AETHELRED_MAINNET_ID, CHAIN_ENV } =
      await importChainsConfig();

    expect(CHAIN_ENV).toBe("mainnet");
    expect(activeChain.id).toBe(AETHELRED_MAINNET_ID);
  });

  it("refuses the undeployed repository mainnet placeholders", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "mainnet";
    process.env.NEXT_PUBLIC_AETHELRED_GENESIS_HASH = `0x${"a".repeat(64)}`;

    await expect(importChainsConfig()).rejects.toThrow(
      "mainnet is not a repository default",
    );
  });

  it("requires an explicit RPC for production testnet bundles", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_CHAIN_ENV = "testnet";
    process.env.NEXT_PUBLIC_AETHELRED_GENESIS_HASH = `0x${"a".repeat(64)}`;

    await expect(importChainsConfig()).rejects.toThrow(
      "NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL is required for production testnet builds",
    );
  });
});
