const LOCAL_API_V1_URL = "http://localhost:3001/v1";
const API_VERSION_PATH = "/v1";

type ChainEnv = "mainnet" | "testnet" | "devnet";

function activeChainEnv(): ChainEnv {
  const value = process.env.NEXT_PUBLIC_CHAIN_ENV;
  return value === "mainnet" || value === "devnet" ? value : "testnet";
}

function appendVersionPath(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith(API_VERSION_PATH)
    ? trimmed
    : `${trimmed}${API_VERSION_PATH}`;
}

function hostnameFor(apiV1Url: string): string | null {
  try {
    return new URL(apiV1Url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function assertApiMatchesChain(apiV1Url: string): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const hostname = hostnameFor(apiV1Url);
  if (!hostname) {
    return;
  }

  const chainEnv = activeChainEnv();
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";

  if (chainEnv !== "mainnet" && hostname.includes("mainnet")) {
    throw new Error(
      "NEXT_PUBLIC_API_URL points at a mainnet API while NEXT_PUBLIC_CHAIN_ENV is not mainnet",
    );
  }

  if (chainEnv === "mainnet" && (hostname.includes("testnet") || isLocalHost)) {
    throw new Error(
      "NEXT_PUBLIC_API_URL must not point at a testnet or local API when NEXT_PUBLIC_CHAIN_ENV=mainnet",
    );
  }
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

  const apiV1Url = appendVersionPath(configuredUrl);
  assertApiMatchesChain(apiV1Url);
  return apiV1Url;
}

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiV1BaseUrl()}${normalizedPath}`;
}
