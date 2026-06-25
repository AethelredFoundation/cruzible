import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const playwrightConfig = readFileSync(
  resolve(process.cwd(), "playwright.config.ts"),
  "utf8",
);

describe("Playwright production smoke config", () => {
  it("supplies every required public build variable for testnet E2E builds", () => {
    for (const envKey of [
      "NEXT_PUBLIC_API_URL",
      "NEXT_PUBLIC_CHAIN_ENV",
      "NEXT_PUBLIC_CRUZIBLE_ADDRESS",
      "NEXT_PUBLIC_STAETHEL_ADDRESS",
      "NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS",
      "NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS",
      "NEXT_PUBLIC_USDC_TOKEN_ADDRESS",
      "NEXT_PUBLIC_USDT_TOKEN_ADDRESS",
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    ]) {
      expect(playwrightConfig).toContain(envKey);
    }

    expect(playwrightConfig).toContain("e2ePublicEnvCommand");
    expect(playwrightConfig).toContain("npm run build");
    expect(playwrightConfig).toContain(".next/standalone/server.js");
    expect(playwrightConfig).toContain("timeout: 300_000");
  });
});
