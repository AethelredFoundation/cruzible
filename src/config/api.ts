const LOCAL_API_V1_URL = "http://localhost:3001/v1";
const API_VERSION_PATH = "/v1";
type ChainEnv = "mainnet" | "testnet" | "devnet";
const PRODUCTION_API_ORIGINS_BY_CHAIN: Record<
  Exclude<ChainEnv, "devnet">,
  string[]
> = {
  mainnet: ["https://api.mainnet.aethelred.org"],
  testnet: ["https://api.testnet.aethelred.org"],
};

function extraApiOrigins(): string {
  return process.env.NEXT_PUBLIC_CRUZIBLE_EXTRA_API_ORIGINS ?? "";
}

function allowPlaintextHttp(): boolean {
  return process.env.NEXT_PUBLIC_CRUZIBLE_ALLOW_PLAINTEXT_HTTP === "true";
}

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

function assertAllowedProductionApiOrigin(
  chainEnv: ChainEnv,
  origin: string,
): void {
  if (chainEnv === "devnet" || process.env.NODE_ENV !== "production") {
    return;
  }

  const extraOrigins = extraApiOrigins()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error(
          "NEXT_PUBLIC_CRUZIBLE_EXTRA_API_ORIGINS must contain absolute URLs",
        );
      }
      if (
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname.replace(/\/+$/, "")
      ) {
        throw new Error(
          "NEXT_PUBLIC_CRUZIBLE_EXTRA_API_ORIGINS must contain bare origins without credentials",
        );
      }
      if (
        parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && allowPlaintextHttp())
      ) {
        throw new Error(
          "NEXT_PUBLIC_CRUZIBLE_EXTRA_API_ORIGINS must use https unless the explicit pre-TLS profile is enabled",
        );
      }
      return parsed.origin;
    });
  const allowedOrigins = [
    ...PRODUCTION_API_ORIGINS_BY_CHAIN[chainEnv],
    ...extraOrigins,
  ];
  if (!allowedOrigins.includes(origin)) {
    throw new Error(
      `NEXT_PUBLIC_API_URL must be one of ${allowedOrigins.join(", ")} when NEXT_PUBLIC_CHAIN_ENV=${chainEnv}`,
    );
  }
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
    !(chainEnv === "devnet" && isLocalHost) &&
    !allowPlaintextHttp()
  ) {
    throw new Error(
      "NEXT_PUBLIC_API_URL must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost, or the explicit pre-TLS profile is enabled",
    );
  }

  if (process.env.NODE_ENV !== "production") {
    return `${parsed.origin}${API_VERSION_PATH}`;
  }

  assertAllowedProductionApiOrigin(chainEnv, parsed.origin);

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
