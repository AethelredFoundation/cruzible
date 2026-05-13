import { describe, expect, it } from "vitest";
import { validateFrontendPublicEnv } from "../../scripts/validate-frontend-public-env.mjs";

const mainnetBaseEnv = {
  NODE_ENV: "production" as const,
  NEXT_PUBLIC_API_URL: "https://api.mainnet.aethelred.org",
  NEXT_PUBLIC_CHAIN_ENV: "mainnet",
  NEXT_PUBLIC_CRUZIBLE_ADDRESS: "0x1111111111111111111111111111111111111111",
  NEXT_PUBLIC_STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
  NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS:
    "0x3333333333333333333333333333333333333333",
  NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS:
    "0x4444444444444444444444444444444444444444",
  NEXT_PUBLIC_USDC_TOKEN_ADDRESS: "0x5555555555555555555555555555555555555555",
  NEXT_PUBLIC_USDT_TOKEN_ADDRESS: "0x6666666666666666666666666666666666666666",
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "walletconnect-project",
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

  it("accepts fully configured mainnet builds", () => {
    expect(validateFrontendPublicEnv(mainnetBaseEnv)).toEqual({
      apiOrigin: "https://api.mainnet.aethelred.org",
      chainEnv: "mainnet",
    });
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
      }),
    ).toThrow("NEXT_PUBLIC_API_URL must not include credentials.");
  });

  it("rejects public API URLs with query strings or fragments", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org/v1#token",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
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
      "NEXT_PUBLIC_API_URL must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost.",
    );
  });

  it("keeps testnet builds available for pre-mainnet evidence", () => {
    expect(
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
      }),
    ).toEqual({
      apiOrigin: "https://api.testnet.aethelred.org",
      chainEnv: "testnet",
    });
  });

  it("rejects lookalike production API origins", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org.evil.example",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
      }),
    ).toThrow(
      "NEXT_PUBLIC_API_URL must be one of https://api.testnet.aethelred.org when NEXT_PUBLIC_CHAIN_ENV=testnet.",
    );
  });

  it("allows plaintext localhost only for explicit devnet builds", () => {
    expect(
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "http://localhost:3001/v1",
        NEXT_PUBLIC_CHAIN_ENV: "devnet",
      }),
    ).toEqual({
      apiOrigin: "http://localhost:3001",
      chainEnv: "devnet",
    });
  });

  it("only allows public devtools to be enabled for devnet builds", () => {
    expect(() =>
      validateFrontendPublicEnv({
        NODE_ENV: "production" as const,
        NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
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
        NEXT_PUBLIC_API_URL: "http://localhost:3001/v1",
        NEXT_PUBLIC_CHAIN_ENV: "devnet",
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
        NEXT_PUBLIC_API_URL: "http://localhost:3001/v1",
        NEXT_PUBLIC_CHAIN_ENV: "devnet",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
        NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL: "http://127.0.0.1:8000",
        NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL: "http://localhost:3000",
        NEXT_PUBLIC_DEVTOOLS_RPC_URL: "http://[::1]:26657",
      }),
    ).toEqual({
      apiOrigin: "http://localhost:3001",
      chainEnv: "devnet",
    });
  });
});
