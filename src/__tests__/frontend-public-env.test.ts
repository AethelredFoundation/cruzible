import { describe, expect, it } from "vitest";
import { validateFrontendPublicEnv } from "../../scripts/validate-frontend-public-env.mjs";

const mainnetBaseEnv = {
  NODE_ENV: "production" as const,
  NEXT_PUBLIC_API_URL: "https://api.mainnet.aethelred.org",
  NEXT_PUBLIC_CHAIN_ENV: "mainnet",
  NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID: "7333",
  NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL: "https://rpc.mainnet.example.org",
  NEXT_PUBLIC_AETHELRED_MAINNET_EXPLORER_URL:
    "https://explorer.mainnet.example.org",
  NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"a".repeat(64)}`,
  NEXT_PUBLIC_CRUZIBLE_ADDRESS: "0x1111111111111111111111111111111111111111",
  NEXT_PUBLIC_STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
  NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS:
    "0x3333333333333333333333333333333333333333",
  NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS:
    "0x4444444444444444444444444444444444444444",
  NEXT_PUBLIC_USDC_TOKEN_ADDRESS: "0x5555555555555555555555555555555555555555",
  NEXT_PUBLIC_USDT_TOKEN_ADDRESS: "0x6666666666666666666666666666666666666666",
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "7a4f9c2e1b8d43c6a095f2e7d4b1c830",
};

const testnetBaseEnv = {
  ...mainnetBaseEnv,
  NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org",
  NEXT_PUBLIC_CHAIN_ENV: "testnet",
  NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL: "https://rpc.testnet.example.org",
};

describe("frontend public build environment validation", () => {
  it("requires non-zero contract addresses for mainnet builds", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...mainnetBaseEnv,
        NEXT_PUBLIC_CRUZIBLE_ADDRESS:
          "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(
      "NEXT_PUBLIC_CRUZIBLE_ADDRESS must be a non-zero EVM address when NEXT_PUBLIC_CHAIN_ENV=mainnet.",
    );
  });

  it("requires WalletConnect configuration for mainnet builds", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...mainnetBaseEnv,
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "",
      }),
    ).toThrow(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required when NEXT_PUBLIC_CHAIN_ENV=mainnet.",
    );
  });

  it("requires the full periphery contract set for mainnet builds", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...mainnetBaseEnv,
        NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS: "",
      }),
    ).toThrow(
      "NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS must be a non-zero EVM address when NEXT_PUBLIC_CHAIN_ENV=mainnet.",
    );
  });

  it("requires WalletConnect configuration for deployed testnet builds", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "",
      }),
    ).toThrow(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required when NEXT_PUBLIC_CHAIN_ENV=testnet.",
    );
  });

  it("rejects malformed WalletConnect project IDs", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...mainnetBaseEnv,
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "walletconnect-project",
      }),
    ).toThrow(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be a 32-character hex WalletConnect project ID.",
    );
  });

  it("rejects placeholder WalletConnect project IDs", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...mainnetBaseEnv,
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
          "0123456789abcdef0123456789abcdef",
      }),
    ).toThrow(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must not use a placeholder project ID.",
    );
  });

  it("accepts fully configured mainnet builds", () => {
    expect(validateFrontendPublicEnv(mainnetBaseEnv)).toEqual({
      apiOrigin: "https://api.mainnet.aethelred.org",
      chainEnv: "mainnet",
    });
  });

  it("requires a non-zero genesis hash to isolate same-chain-id networks", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: "",
      }),
    ).toThrow("NEXT_PUBLIC_AETHELRED_GENESIS_HASH is required");
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"0".repeat(64)}`,
      }),
    ).toThrow("must be a non-zero 32-byte hex block hash");
  });

  it("blocks mainnet builds without confirmed network inputs", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...mainnetBaseEnv,
        NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID: "",
      }),
    ).toThrow(
      "NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID is required when NEXT_PUBLIC_CHAIN_ENV=mainnet; the repository has no mainnet defaults.",
    );
  });

  it("rejects a mainnet chain id that aliases confirmed testnet", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...mainnetBaseEnv,
        NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID: "7332",
      }),
    ).toThrow(
      "NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID must be a positive integer distinct from confirmed testnet chain ID 7332.",
    );
  });

  it("requires an explicit chain env for production builds", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org",
      }),
    ).toThrow("NEXT_PUBLIC_CHAIN_ENV is required for production builds.");
  });

  it("rejects public API URLs with credentials", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://user:pass@api.testnet.aethelred.org",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
        NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL:
          "https://rpc.testnet.example.org",
      }),
    ).toThrow("NEXT_PUBLIC_API_URL must not include credentials.");
  });

  it("rejects public API URLs with query strings or fragments", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org/v1#token",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
        NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL: "http://93.127.132.52:8545",
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"a".repeat(64)}`,
      }),
    ).toThrow(
      "NEXT_PUBLIC_API_URL must not include query strings or fragments.",
    );
  });

  it("rejects public API URLs outside the v1 root", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org/admin",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
      }),
    ).toThrow("NEXT_PUBLIC_API_URL path must be empty or /v1.");
  });

  it("rejects non-local plaintext public API URLs", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "http://api.testnet.aethelred.org",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
      }),
    ).toThrow(
      "NEXT_PUBLIC_API_URL must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost, or CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true",
    );
  });

  it("accepts fully configured testnet builds for pre-mainnet evidence", () => {
    expect(validateFrontendPublicEnv(testnetBaseEnv)).toEqual({
      apiOrigin: "https://api.testnet.aethelred.org",
      chainEnv: "testnet",
    });
  });

  it("rejects testnet builds without an explicit RPC endpoint", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL: "",
      }),
    ).toThrow(
      "NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL is required when NEXT_PUBLIC_CHAIN_ENV=testnet.",
    );
  });

  it("allows a plaintext testnet RPC only under the pre-TLS profile", () => {
    expect(
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL: "http://203.0.113.10:8545",
        CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "true",
      }),
    ).toEqual({
      apiOrigin: "https://api.testnet.aethelred.org",
      chainEnv: "testnet",
    });

    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL: "http://203.0.113.10:8545",
      }),
    ).toThrow("NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL must use https");
  });

  it("validates optional ZeroID and app-version browser config", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_ZEROID_APP_URL: "javascript:alert(1)",
      }),
    ).toThrow("NEXT_PUBLIC_ZEROID_APP_URL must use http or https.");
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_APP_VERSION: "release with spaces",
      }),
    ).toThrow("NEXT_PUBLIC_APP_VERSION must be 1-128 safe version characters.");
  });

  it("rejects malformed optional public contract addresses", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_GOVERNANCE_ADDRESS: "not-an-address",
      }),
    ).toThrow(
      "NEXT_PUBLIC_GOVERNANCE_ADDRESS must be blank or a non-zero EVM address.",
    );
  });

  it("rejects zero optional public contract addresses outside mainnet", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_CRUZIBLE_ADDRESS:
          "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(
      "NEXT_PUBLIC_CRUZIBLE_ADDRESS must be a non-zero EVM address when NEXT_PUBLIC_CHAIN_ENV=testnet.",
    );
  });

  it("rejects lookalike production API origins", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org.evil.example",
      }),
    ).toThrow(
      "NEXT_PUBLIC_API_URL must be one of https://api.testnet.aethelred.org when NEXT_PUBLIC_CHAIN_ENV=testnet.",
    );
  });

  it("allows plaintext localhost only for explicit devnet builds", () => {
    expect(
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "http://localhost:4001/v1",
        NEXT_PUBLIC_CHAIN_ENV: "devnet",
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"d".repeat(64)}`,
      }),
    ).toEqual({
      apiOrigin: "http://localhost:4001",
      chainEnv: "devnet",
    });
  });

  it("only allows public devtools to be enabled for devnet builds", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
      }),
    ).toThrow(
      "NEXT_PUBLIC_ENABLE_DEVTOOLS may only be true when NEXT_PUBLIC_CHAIN_ENV=devnet.",
    );
  });

  it("rejects non-local public devtools URLs when enabled", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "http://localhost:4001/v1",
        NEXT_PUBLIC_CHAIN_ENV: "devnet",
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"d".repeat(64)}`,
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
        NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL: "https://verifier.example.com",
      }),
    ).toThrow(
      "NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL must point to localhost when devtools are enabled.",
    );
  });

  it("accepts local public devtools URLs for explicit devnet builds", () => {
    expect(
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "http://localhost:4001/v1",
        NEXT_PUBLIC_CHAIN_ENV: "devnet",
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"d".repeat(64)}`,
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
        NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL: "http://127.0.0.1:8000",
        NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL: "http://localhost:3000",
        NEXT_PUBLIC_DEVTOOLS_RPC_URL: "http://[::1]:26657",
      }),
    ).toEqual({
      apiOrigin: "http://localhost:4001",
      chainEnv: "devnet",
    });
  });

  it("accepts a self-hosted testnet API origin allowlisted via CRUZIBLE_EXTRA_API_ORIGINS", () => {
    expect(
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_API_URL: "https://54.165.44.130:4001/v1",
        CRUZIBLE_EXTRA_API_ORIGINS: "https://54.165.44.130:4001",
      }),
    ).toEqual({
      apiOrigin: "https://54.165.44.130:4001",
      chainEnv: "testnet",
    });
  });

  it("still rejects testnet API origins missing from the extra allowlist", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_API_URL: "https://198.51.100.7:4001/v1",
        CRUZIBLE_EXTRA_API_ORIGINS: "https://54.165.44.130:4001",
      }),
    ).toThrow("NEXT_PUBLIC_API_URL must be one of");
  });

  it("rejects plaintext http entries in CRUZIBLE_EXTRA_API_ORIGINS", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_API_URL: "https://54.165.44.130:4001/v1",
        CRUZIBLE_EXTRA_API_ORIGINS: "http://54.165.44.130:4001",
      }),
    ).toThrow("CRUZIBLE_EXTRA_API_ORIGINS entries must use https");
  });

  it("accepts testnet builds with only the deployable contracts set", () => {
    expect(
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"a".repeat(64)}`,
        NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL:
          "https://rpc.testnet.example.org",
        NEXT_PUBLIC_CRUZIBLE_ADDRESS:
          "0x1111111111111111111111111111111111111111",
        NEXT_PUBLIC_STAETHEL_ADDRESS:
          "0x2222222222222222222222222222222222222222",
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
          "7a4f9c2e1b8d43c6a095f2e7d4b1c830",
      }),
    ).toEqual({
      apiOrigin: "https://api.testnet.aethelred.org",
      chainEnv: "testnet",
    });
  });

  it("still requires the vault and stAETHEL addresses for testnet builds", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"a".repeat(64)}`,
        NEXT_PUBLIC_STAETHEL_ADDRESS:
          "0x2222222222222222222222222222222222222222",
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
          "7a4f9c2e1b8d43c6a095f2e7d4b1c830",
      }),
    ).toThrow(
      "NEXT_PUBLIC_CRUZIBLE_ADDRESS must be a non-zero EVM address when NEXT_PUBLIC_CHAIN_ENV=testnet.",
    );
  });

  it("accepts an http API origin under the plaintext testing profile", () => {
    expect(
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "http://93.127.132.52:4001/v1",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
        NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL: "http://93.127.132.52:8545",
        CRUZIBLE_EXTRA_API_ORIGINS: "http://93.127.132.52:4001",
        CRUZIBLE_ALLOW_PLAINTEXT_HTTP: "true",
        NEXT_PUBLIC_AETHELRED_GENESIS_HASH: `0x${"a".repeat(64)}`,
        NEXT_PUBLIC_CRUZIBLE_ADDRESS:
          "0x1111111111111111111111111111111111111111",
        NEXT_PUBLIC_STAETHEL_ADDRESS:
          "0x2222222222222222222222222222222222222222",
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
          "7a4f9c2e1b8d43c6a095f2e7d4b1c830",
      }),
    ).toEqual({
      apiOrigin: "http://93.127.132.52:4001",
      chainEnv: "testnet",
    });
  });

  it("rejects http API origins without the plaintext testing profile", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "http://93.127.132.52:4001/v1",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
        CRUZIBLE_EXTRA_API_ORIGINS: "http://93.127.132.52:4001",
        NEXT_PUBLIC_CRUZIBLE_ADDRESS:
          "0x1111111111111111111111111111111111111111",
        NEXT_PUBLIC_STAETHEL_ADDRESS:
          "0x2222222222222222222222222222222222222222",
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
          "7a4f9c2e1b8d43c6a095f2e7d4b1c830",
      }),
    ).toThrow(
      "NEXT_PUBLIC_API_URL must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost, or CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true",
    );
  });

  it("rejects deep-path entries in CRUZIBLE_EXTRA_API_ORIGINS", () => {
    expect(() =>
      validateFrontendPublicEnv({
        ...testnetBaseEnv,
        NEXT_PUBLIC_API_URL: "https://54.165.44.130:4001/v1",
        CRUZIBLE_EXTRA_API_ORIGINS: "https://54.165.44.130:4001/v1",
      }),
    ).toThrow(
      "CRUZIBLE_EXTRA_API_ORIGINS entries must be bare origins, not deep paths",
    );
  });
});
