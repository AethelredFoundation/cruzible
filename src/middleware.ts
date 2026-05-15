import { NextResponse, type NextRequest } from "next/server";

type CspOptions = {
  nonce: string;
  nodeEnv?: string;
  apiUrl?: string;
  chainEnv?: string;
};

type ChainEnv = "mainnet" | "testnet" | "devnet";

const DEFAULT_NON_PRODUCTION_CHAIN_ENV: ChainEnv = "testnet";
const PRODUCTION_API_ORIGINS_BY_CHAIN: Record<
  Exclude<ChainEnv, "devnet">,
  readonly string[]
> = {
  mainnet: ["https://api.mainnet.aethelred.org"],
  testnet: ["https://api.testnet.aethelred.org"],
};

const CONNECT_SOURCES_BY_CHAIN: Record<ChainEnv, readonly string[]> = {
  mainnet: [
    "https://api.mainnet.aethelred.org",
    "https://evm-rpc.aethelred.network",
    "wss://evm-ws.aethelred.network",
  ],
  testnet: [
    "https://api.testnet.aethelred.org",
    "https://evm-rpc-testnet.aethelred.network",
    "wss://evm-ws-testnet.aethelred.network",
  ],
  devnet: [
    "http://localhost:*",
    "http://127.0.0.1:*",
    "ws://localhost:*",
    "ws://127.0.0.1:*",
  ],
};

function resolveChainEnv(
  value: string | undefined,
  isProduction: boolean,
): ChainEnv | null {
  const normalized = value?.trim();

  if (
    normalized === "mainnet" ||
    normalized === "testnet" ||
    normalized === "devnet"
  ) {
    return normalized;
  }

  return isProduction ? null : DEFAULT_NON_PRODUCTION_CHAIN_ENV;
}

function isAllowedProductionApiOrigin(
  chainEnv: ChainEnv | null,
  origin: string,
): boolean {
  if (chainEnv === "mainnet" || chainEnv === "testnet") {
    return PRODUCTION_API_ORIGINS_BY_CHAIN[chainEnv].includes(origin);
  }

  return false;
}

function sourceForUrl(
  value: string | undefined,
  isProduction: boolean,
  chainEnv: ChainEnv | null,
): string | null {
  if (!value) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:")
  ) {
    return null;
  }

  if (isProduction && !isAllowedProductionApiOrigin(chainEnv, parsed.origin)) {
    return null;
  }

  return parsed.origin;
}

function connectSourcesForChain(
  chainEnv: ChainEnv | null,
  isProduction: boolean,
): readonly string[] {
  if (!chainEnv) {
    return [];
  }

  if (chainEnv === "devnet" && isProduction) {
    return [];
  }

  return CONNECT_SOURCES_BY_CHAIN[chainEnv];
}

function uniqueSources(sources: Array<string | null>): string[] {
  return [...new Set(sources.filter(Boolean) as string[])];
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function buildContentSecurityPolicy({
  nonce,
  nodeEnv = process.env.NODE_ENV,
  apiUrl = process.env.NEXT_PUBLIC_API_URL,
  chainEnv: configuredChainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV,
}: CspOptions): string {
  if (!nonce || /[<>&]/u.test(nonce)) {
    throw new Error("Invalid CSP nonce");
  }

  const isProduction = nodeEnv === "production";
  const chainEnv = resolveChainEnv(configuredChainEnv, isProduction);
  const nonceSource = `'nonce-${nonce}'`;
  const configuredApiOrigin = sourceForUrl(apiUrl, isProduction, chainEnv);
  const connectSrc = uniqueSources([
    "'self'",
    configuredApiOrigin,
    ...connectSourcesForChain(chainEnv, isProduction),
    "https://*.walletconnect.com",
    "wss://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.org",
  ]);

  return [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    [
      "script-src",
      "'self'",
      nonceSource,
      "'strict-dynamic'",
      ...(isProduction ? [] : ["'unsafe-eval'", "'unsafe-inline'"]),
    ],
    [
      "style-src",
      "'self'",
      nonceSource,
      ...(isProduction ? [] : ["'unsafe-inline'"]),
    ],
    [
      "style-src-elem",
      "'self'",
      nonceSource,
      ...(isProduction ? [] : ["'unsafe-inline'"]),
    ],
    [
      "style-src-attr",
      // Wallet and chart widgets render dynamic style attributes. Keep this
      // isolated from style-src/style-src-elem so tags still need the nonce.
      "'unsafe-inline'",
    ],
    [
      "img-src",
      "'self'",
      "data:",
      "blob:",
      "https://api.aethelred.io",
      "https://vault.aethelred.org",
      "https://cruzible.aethelred.org",
      "https://cruzible.aethelred.network",
    ],
    ["font-src", "'self'", "data:"],
    ["connect-src", ...connectSrc],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["form-action", "'self'"],
    [
      "frame-src",
      "'self'",
      "https://verify.walletconnect.com",
      "https://verify.walletconnect.org",
    ],
    ["frame-ancestors", "'none'"],
    ...(isProduction ? [["upgrade-insecure-requests"]] : []),
  ]
    .map((directive) => directive.join(" "))
    .join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({ nonce });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/|favicon.ico|favicon.svg|apple-touch-icon.png|site.webmanifest|sitemap.xml|sitemap-0.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
