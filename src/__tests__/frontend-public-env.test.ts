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
});
