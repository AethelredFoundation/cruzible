import { fileURLToPath } from "node:url";

const allowedChainEnvs = new Set(["mainnet", "testnet", "devnet"]);
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAINNET_REQUIRED_KEYS = [
  "NEXT_PUBLIC_CRUZIBLE_ADDRESS",
  "NEXT_PUBLIC_STAETHEL_ADDRESS",
  "NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS",
  "NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS",
  "NEXT_PUBLIC_USDC_TOKEN_ADDRESS",
  "NEXT_PUBLIC_USDT_TOKEN_ADDRESS",
  "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
];

export class FrontendPublicEnvError extends Error {
  constructor(message) {
    super(message);
    this.name = "FrontendPublicEnvError";
  }
}

function isLocalApiHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function assertValidAddress(env, key) {
  const value = env[key]?.trim();
  if (
    !value ||
    !EVM_ADDRESS_PATTERN.test(value) ||
    value.toLowerCase() === ZERO_EVM_ADDRESS
  ) {
    throw new FrontendPublicEnvError(
      `${key} must be a non-zero EVM address when NEXT_PUBLIC_CHAIN_ENV=mainnet.`,
    );
  }
}

export function validateFrontendPublicEnv(env = process.env) {
  const apiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  const chainEnv = env.NEXT_PUBLIC_CHAIN_ENV?.trim() || "testnet";

  if (!apiUrl) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL is required at build time because Next.js public env is compiled into browser bundles.",
    );
  }

  if (!allowedChainEnvs.has(chainEnv)) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_CHAIN_ENV must be one of mainnet, testnet, or devnet.",
    );
  }

  let parsedApiUrl;

  try {
    parsedApiUrl = new URL(apiUrl);
  } catch {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must be an absolute URL.",
    );
  }

  if (parsedApiUrl.protocol !== "https:" && parsedApiUrl.protocol !== "http:") {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must use http or https.",
    );
  }

  const hostname = parsedApiUrl.hostname.toLowerCase();
  const isLocalHost = isLocalApiHost(hostname);

  if (chainEnv !== "devnet" && isLocalHost) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must not point at localhost unless NEXT_PUBLIC_CHAIN_ENV=devnet.",
    );
  }

  if (chainEnv !== "mainnet" && hostname.includes("mainnet")) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL points at a mainnet API while NEXT_PUBLIC_CHAIN_ENV is not mainnet.",
    );
  }

  if (chainEnv === "mainnet" && hostname.includes("testnet")) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must not point at a testnet API when NEXT_PUBLIC_CHAIN_ENV=mainnet.",
    );
  }

  if (chainEnv === "mainnet") {
    for (const key of MAINNET_REQUIRED_KEYS) {
      if (key === "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID") {
        if (!env[key]?.trim()) {
          throw new FrontendPublicEnvError(
            "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required when NEXT_PUBLIC_CHAIN_ENV=mainnet.",
          );
        }
        continue;
      }

      assertValidAddress(env, key);
    }
  }

  return {
    apiOrigin: parsedApiUrl.origin,
    chainEnv,
  };
}

function fail(message) {
  console.error(`Invalid frontend public build environment: ${message}`);
  process.exit(1);
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  try {
    const result = validateFrontendPublicEnv();
    console.log(
      `Frontend public API build config validated for ${result.chainEnv}: ${result.apiOrigin}`,
    );
  } catch (error) {
    if (error instanceof FrontendPublicEnvError) {
      fail(error.message);
    }

    throw error;
  }
}
