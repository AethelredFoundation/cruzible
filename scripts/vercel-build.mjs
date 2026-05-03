import { spawnSync } from "node:child_process";

const env = { ...process.env };

if (env.VERCEL_ENV === "preview" && !env.NEXT_PUBLIC_API_URL?.trim()) {
  env.NEXT_PUBLIC_API_URL = "https://api.testnet.aethelred.org";
  env.NEXT_PUBLIC_CHAIN_ENV = env.NEXT_PUBLIC_CHAIN_ENV?.trim() || "testnet";
  console.warn(
    "Using testnet public API defaults for Vercel preview build. Configure explicit env for production deployments.",
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
