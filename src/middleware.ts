import { NextResponse, type NextRequest } from "next/server";

type CspOptions = {
  nonce: string;
  nodeEnv?: string;
  apiUrl?: string;
};

function sourceForUrl(value?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
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
}: CspOptions): string {
  if (!nonce || /[<>&]/u.test(nonce)) {
    throw new Error("Invalid CSP nonce");
  }

  const isProduction = nodeEnv === "production";
  const nonceSource = `'nonce-${nonce}'`;
  const configuredApiOrigin = sourceForUrl(apiUrl);
  const devnetSources = isProduction
    ? []
    : [
        "http://localhost:*",
        "http://127.0.0.1:*",
        "ws://localhost:*",
        "ws://127.0.0.1:*",
      ];
  const connectSrc = uniqueSources([
    "'self'",
    configuredApiOrigin,
    "https://api.aethelred.io",
    "https://api.mainnet.aethelred.org",
    "https://api.testnet.aethelred.org",
    "https://evm-rpc.aethelred.network",
    "https://evm-rpc-testnet.aethelred.network",
    "wss://evm-ws.aethelred.network",
    "wss://evm-ws-testnet.aethelred.network",
    "https://*.walletconnect.com",
    "wss://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.org",
    ...devnetSources,
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
    ["style-src-attr", "'unsafe-inline'"],
    [
      "img-src",
      "'self'",
      "data:",
      "blob:",
      "https://api.aethelred.io",
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
