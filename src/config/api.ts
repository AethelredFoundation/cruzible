const LOCAL_API_V1_URL = "http://localhost:3001/v1";
const API_VERSION_PATH = "/v1";

type ChainEnv = "mainnet" | "testnet" | "devnet";

function activeChainEnv(): ChainEnv {
  const value = process.env.NEXT_PUBLIC_CHAIN_ENV;
  if (value === "mainnet" || value === "testnet" || value === "devnet") {
    return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_CHAIN_ENV is required in production");
  }
  return "testnet";
}

function isLocalApiHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function normalizeConfiguredApiUrl(configuredUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_API_URL must be an absolute URL");
  }

  if (parsed.username || parsed.password) {
    throw new Error("NEXT_PUBLIC_API_URL must not include credentials");
  }

  if (parsed.search || parsed.hash) {
    throw new Error(
      "NEXT_PUBLIC_API_URL must not include query strings or fragments",
    );
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath && normalizedPath !== API_VERSION_PATH) {
    throw new Error("NEXT_PUBLIC_API_URL path must be empty or /v1");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_API_URL must use http or https");
  }

  const chainEnv = activeChainEnv();
  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost = isLocalApiHost(hostname);

  if (
    process.env.NODE_ENV === "production" &&
    chainEnv !== "devnet" &&
    isLocalHost
  ) {
    throw new Error(
      "NEXT_PUBLIC_API_URL must not point at localhost unless NEXT_PUBLIC_CHAIN_ENV=devnet",
    );
  }

  if (
    parsed.protocol !== "https:" &&
    !(chainEnv === "devnet" && isLocalHost)
  ) {
    throw new Error(
      "NEXT_PUBLIC_API_URL must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost",
    );
  }

  if (process.env.NODE_ENV !== "production") {
    return `${parsed.origin}${API_VERSION_PATH}`;
  }

  if (chainEnv !== "mainnet" && hostname.includes("mainnet")) {
    throw new Error(
      "NEXT_PUBLIC_API_URL points at a mainnet API while NEXT_PUBLIC_CHAIN_ENV is not mainnet",
    );
  }

  if (chainEnv === "mainnet" && hostname.includes("testnet")) {
    throw new Error(
      "NEXT_PUBLIC_API_URL must not point at a testnet API when NEXT_PUBLIC_CHAIN_ENV=mainnet",
    );
  }

  return `${parsed.origin}${API_VERSION_PATH}`;
}

export function getApiV1BaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (!configuredUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_API_URL is required for production public-data requests",
      );
    }

    return LOCAL_API_V1_URL;
  }

  return normalizeConfiguredApiUrl(configuredUrl);
}

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiV1BaseUrl()}${normalizedPath}`;
}
