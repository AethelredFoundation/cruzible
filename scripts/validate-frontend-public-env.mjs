import { fileURLToPath } from "node:url";

const allowedChainEnvs = new Set(["mainnet", "testnet", "devnet"]);
const productionApiOriginsByChain = {
  mainnet: ["https://api.mainnet.aethelred.org"],
  testnet: ["https://api.testnet.aethelred.org"],
};
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
const DEVTOOLS_URL_KEYS = [
  "NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL",
  "NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL",
  "NEXT_PUBLIC_DEVTOOLS_RPC_URL",
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

function assertValidLocalDevtoolsOrigin(env, key) {
  const value = env[key]?.trim();
  if (!value) {
    return;
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new FrontendPublicEnvError(`${key} must be an absolute URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FrontendPublicEnvError(`${key} must use http or https.`);
  }

  if (parsed.username || parsed.password) {
    throw new FrontendPublicEnvError(`${key} must not include credentials.`);
  }

  if (parsed.search || parsed.hash) {
    throw new FrontendPublicEnvError(
      `${key} must not include query strings or fragments.`,
    );
  }

  if (parsed.pathname.replace(/\/+$/, "")) {
    throw new FrontendPublicEnvError(
      `${key} must be a service origin, not a deep path.`,
    );
  }

  if (!isLocalApiHost(parsed.hostname.toLowerCase())) {
    throw new FrontendPublicEnvError(
      `${key} must point to localhost when devtools are enabled.`,
    );
  }
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

function assertAllowedProductionApiOrigin(chainEnv, origin) {
  if (chainEnv === "devnet") {
    return;
  }

  const allowedOrigins = productionApiOriginsByChain[chainEnv];
  if (!allowedOrigins.includes(origin)) {
    throw new FrontendPublicEnvError(
      `NEXT_PUBLIC_API_URL must be one of ${allowedOrigins.join(", ")} when NEXT_PUBLIC_CHAIN_ENV=${chainEnv}.`,
    );
  }
}

export function validateFrontendPublicEnv(env = process.env) {
  const apiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  const rawChainEnv = env.NEXT_PUBLIC_CHAIN_ENV?.trim();
  const chainEnv = rawChainEnv || "testnet";

  if (!apiUrl) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL is required at build time because Next.js public env is compiled into browser bundles.",
    );
  }

  if (env.NODE_ENV === "production" && !rawChainEnv) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_CHAIN_ENV is required for production builds.",
    );
  }

  if (!allowedChainEnvs.has(chainEnv)) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_CHAIN_ENV must be one of mainnet, testnet, or devnet.",
    );
  }

  if (env.NEXT_PUBLIC_ENABLE_DEVTOOLS?.trim() === "true") {
    if (chainEnv !== "devnet") {
      throw new FrontendPublicEnvError(
        "NEXT_PUBLIC_ENABLE_DEVTOOLS may only be true when NEXT_PUBLIC_CHAIN_ENV=devnet.",
      );
    }

    for (const key of DEVTOOLS_URL_KEYS) {
      assertValidLocalDevtoolsOrigin(env, key);
    }
  }

  let parsedApiUrl;

  try {
    parsedApiUrl = new URL(apiUrl);
  } catch {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must be an absolute URL.",
    );
  }

  if (parsedApiUrl.username || parsedApiUrl.password) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must not include credentials.",
    );
  }

  if (parsedApiUrl.search || parsedApiUrl.hash) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must not include query strings or fragments.",
    );
  }

  const normalizedPath = parsedApiUrl.pathname.replace(/\/+$/, "");
  if (normalizedPath && normalizedPath !== "/v1") {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL path must be empty or /v1.",
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

  if (
    parsedApiUrl.protocol !== "https:" &&
    !(chainEnv === "devnet" && isLocalHost)
  ) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost.",
    );
  }

  assertAllowedProductionApiOrigin(chainEnv, parsedApiUrl.origin);

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
