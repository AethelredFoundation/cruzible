import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const e2ePublicEnv = {
  NEXT_PUBLIC_API_URL: "https://api.testnet.aethelred.org",
  NEXT_PUBLIC_CHAIN_ENV: "testnet",
  NEXT_PUBLIC_CRUZIBLE_ADDRESS: "0x1111111111111111111111111111111111111111",
  NEXT_PUBLIC_STAETHEL_ADDRESS: "0x2222222222222222222222222222222222222222",
  NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS:
    "0x3333333333333333333333333333333333333333",
  NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS:
    "0x4444444444444444444444444444444444444444",
  NEXT_PUBLIC_USDC_TOKEN_ADDRESS: "0x5555555555555555555555555555555555555555",
  NEXT_PUBLIC_USDT_TOKEN_ADDRESS: "0x6666666666666666666666666666666666666666",
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "0123456789abcdef0123456789abcdef",
} as const;
const e2ePublicEnvCommand = Object.entries(e2ePublicEnv)
  .map(([key, value]) => `${key}=${value}`)
  .join(" ");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `${e2ePublicEnvCommand} npm run build && PORT=${port} HOSTNAME=127.0.0.1 node .next/standalone/server.js`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
