import { spawnSync } from "node:child_process";

const env = { ...process.env };

if (env.VERCEL_ENV === "preview" && !env.NEXT_PUBLIC_API_URL?.trim()) {
  env.NEXT_PUBLIC_API_URL = "https://api.testnet.aethelred.org";
  env.NEXT_PUBLIC_CHAIN_ENV = env.NEXT_PUBLIC_CHAIN_ENV?.trim() || "testnet";
  env.NEXT_PUBLIC_CRUZIBLE_ADDRESS =
    env.NEXT_PUBLIC_CRUZIBLE_ADDRESS?.trim() ||
    "0x1111111111111111111111111111111111111111";
  env.NEXT_PUBLIC_STAETHEL_ADDRESS =
    env.NEXT_PUBLIC_STAETHEL_ADDRESS?.trim() ||
    "0x2222222222222222222222222222222222222222";
  env.NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS =
    env.NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS?.trim() ||
    "0x3333333333333333333333333333333333333333";
  env.NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS =
    env.NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS?.trim() ||
    "0x4444444444444444444444444444444444444444";
  env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS =
    env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS?.trim() ||
    "0x5555555555555555555555555555555555555555";
  env.NEXT_PUBLIC_USDT_TOKEN_ADDRESS =
    env.NEXT_PUBLIC_USDT_TOKEN_ADDRESS?.trim() ||
    "0x6666666666666666666666666666666666666666";
  env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID =
    env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
    "0123456789abcdef0123456789abcdef";
  console.warn(
    "Using testnet public preview defaults for Vercel preview build. Configure explicit env for production deployments.",
  );
}

const result = spawnSync("npm", ["run", "build"], {
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
