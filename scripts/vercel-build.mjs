import { spawnSync } from "node:child_process";

const env = { ...process.env };

if (env.VERCEL_ENV === "preview" && !env.NEXT_PUBLIC_API_URL?.trim()) {
  env.NEXT_PUBLIC_API_URL = "https://api.testnet.aethelred.org";
  env.NEXT_PUBLIC_CHAIN_ENV = env.NEXT_PUBLIC_CHAIN_ENV?.trim() || "testnet";
  if (!env.NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL?.trim()) {
    console.error(
      "Vercel previews require NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL; no undeployed RPC fallback is compiled into previews.",
    );
    process.exit(1);
  }
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
    "7a4f9c2e1b8d43c6a095f2e7d4b1c830";
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
