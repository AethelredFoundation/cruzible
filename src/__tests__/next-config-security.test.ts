import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy, middleware } from "@/middleware";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../../next.config.js");

function loadNextConfig(nodeEnv: string) {
  delete require.cache[configPath];
  vi.stubEnv("NODE_ENV", nodeEnv);
  return require("../../next.config.js") as {
    images: { remotePatterns: Array<{ protocol: string; hostname: string }> };
    productionBrowserSourceMaps: boolean;
    headers: () => Promise<
      Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    >;
    webpack: (
      config: {
        resolve: {
          alias: Record<string, unknown>;
          fallback?: Record<string, unknown>;
        };
        optimization: { splitChunks?: unknown; minimize?: boolean };
        plugins: unknown[];
      },
      options: { isServer: boolean; dev: boolean },
    ) => {
      resolve: {
        alias: Record<string, unknown>;
        fallback?: Record<string, unknown>;
      };
      optimization: { splitChunks?: unknown; minimize?: boolean };
      plugins: unknown[];
    };
  };
}

async function getGlobalSecurityHeader(name: string, nodeEnv = "production") {
  const nextConfig = loadNextConfig(nodeEnv);
  const headerRules = await nextConfig.headers();
  const globalRule = headerRules.find((rule) => rule.source === "/:path*");
  return globalRule?.headers.find((header) => header.key === name)?.value;
}

function getCspDirective(csp: string, name: string): string {
  return (
    csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith(`${name} `)) ?? ""
  );
}

describe("Next.js security config", () => {
  afterEach(() => {
    delete require.cache[configPath];
    vi.unstubAllEnvs();
  });

  it("does not allow localhost image optimization sources in production", () => {
    const nextConfig = loadNextConfig("production");

    expect(nextConfig.images.remotePatterns).not.toContainEqual({
      protocol: "http",
      hostname: "localhost",
    });
    expect(nextConfig.images.remotePatterns).toContainEqual({
      protocol: "https",
      hostname: "api.aethelred.io",
    });
  });

  it("keeps localhost image optimization available outside production", () => {
    const nextConfig = loadNextConfig("development");

    expect(nextConfig.images.remotePatterns).toContainEqual({
      protocol: "http",
      hostname: "localhost",
    });
  });

  it("does not publish production browser source maps", () => {
    const nextConfig = loadNextConfig("production");

    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
  });

  it("sets an explicit resource-loading Content Security Policy", async () => {
    const csp = buildContentSecurityPolicy({
      nonce: "test-nonce",
      nodeEnv: "production",
      apiUrl: "https://api.testnet.aethelred.org/v1",
      chainEnv: "testnet",
    });

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(
      "script-src 'self' 'nonce-test-nonce' 'strict-dynamic'",
    );
    expect(csp).toContain("style-src 'self' 'nonce-test-nonce'");
    expect(csp).toContain("style-src-elem 'self' 'nonce-test-nonce'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(getCspDirective(csp, "script-src")).not.toContain("'unsafe-inline'");
    expect(getCspDirective(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(getCspDirective(csp, "style-src-elem")).not.toContain(
      "'unsafe-inline'",
    );
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain(
      "connect-src 'self' https://api.testnet.aethelred.org",
    );
    expect(csp).toContain("https://api.testnet.aethelred.org");
    expect(csp).toContain("wss://evm-ws-testnet.aethelred.network");
    expect(csp).not.toContain("https://api.mainnet.aethelred.org");
    expect(csp).not.toContain("https://evm-rpc.aethelred.network");
    expect(csp).not.toContain("wss://evm-ws.aethelred.network");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("scopes production CSP connect sources to the active mainnet environment", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "test-nonce",
      nodeEnv: "production",
      apiUrl: "https://api.mainnet.aethelred.org/v1",
      chainEnv: "mainnet",
    });
    const connectSrc = getCspDirective(csp, "connect-src");

    expect(connectSrc).toContain("https://api.mainnet.aethelred.org");
    expect(connectSrc).toContain("https://evm-rpc.aethelred.network");
    expect(connectSrc).toContain("wss://evm-ws.aethelred.network");
    expect(connectSrc).not.toContain("https://api.testnet.aethelred.org");
    expect(connectSrc).not.toContain(
      "https://evm-rpc-testnet.aethelred.network",
    );
    expect(connectSrc).not.toContain("wss://evm-ws-testnet.aethelred.network");
  });

  it("fails closed on unsafe production API origins in CSP", () => {
    const lookalikeCsp = buildContentSecurityPolicy({
      nonce: "test-nonce",
      nodeEnv: "production",
      apiUrl: "https://api.testnet.aethelred.org.evil.example/v1",
      chainEnv: "testnet",
    });
    const localhostCsp = buildContentSecurityPolicy({
      nonce: "test-nonce",
      nodeEnv: "production",
      apiUrl: "http://localhost:3001/v1",
      chainEnv: "testnet",
    });
    const credentialedCsp = buildContentSecurityPolicy({
      nonce: "test-nonce",
      nodeEnv: "production",
      apiUrl: "https://user:pass@api.testnet.aethelred.org/v1",
      chainEnv: "testnet",
    });

    expect(getCspDirective(lookalikeCsp, "connect-src")).not.toContain(
      "https://api.testnet.aethelred.org.evil.example",
    );
    expect(getCspDirective(localhostCsp, "connect-src")).not.toContain(
      "http://localhost:3001",
    );
    expect(getCspDirective(credentialedCsp, "connect-src")).not.toContain(
      "https://user:pass@",
    );
  });

  it("does not set a stale static CSP header from next.config", async () => {
    await expect(
      getGlobalSecurityHeader("Content-Security-Policy"),
    ).resolves.toBeUndefined();
  });

  it("emits a per-request nonce-bearing CSP from middleware", () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = middleware(
      new NextRequest("https://vault.aethelred.org/vault"),
    );
    const csp = response.headers.get("Content-Security-Policy");

    expect(csp).toMatch(
      /script-src 'self' 'nonce-[a-f0-9]{32}' 'strict-dynamic'/u,
    );
    expect(getCspDirective(csp ?? "", "script-src")).not.toContain(
      "'unsafe-inline'",
    );
  });

  it("sets browser isolation and legacy plugin blocking headers", async () => {
    await expect(
      getGlobalSecurityHeader("X-DNS-Prefetch-Control"),
    ).resolves.toBe("off");
    await expect(getGlobalSecurityHeader("Referrer-Policy")).resolves.toBe(
      "no-referrer",
    );
    await expect(
      getGlobalSecurityHeader("Cross-Origin-Opener-Policy"),
    ).resolves.toBe("same-origin-allow-popups");
    await expect(
      getGlobalSecurityHeader("Cross-Origin-Resource-Policy"),
    ).resolves.toBe("same-site");
    await expect(getGlobalSecurityHeader("Origin-Agent-Cluster")).resolves.toBe(
      "?1",
    );
    await expect(
      getGlobalSecurityHeader("X-Permitted-Cross-Domain-Policies"),
    ).resolves.toBe("none");
  });

  it("disables high-risk browser capabilities by default", async () => {
    const permissionsPolicy =
      await getGlobalSecurityHeader("Permissions-Policy");

    expect(permissionsPolicy).toBeDefined();
    for (const feature of [
      "accelerometer",
      "autoplay",
      "browsing-topics",
      "camera",
      "display-capture",
      "encrypted-media",
      "gamepad",
      "geolocation",
      "gyroscope",
      "interest-cohort",
      "magnetometer",
      "microphone",
      "midi",
      "payment",
      "publickey-credentials-get",
      "screen-wake-lock",
      "serial",
      "speaker-selection",
      "usb",
      "xr-spatial-tracking",
    ]) {
      expect(permissionsPolicy).toContain(`${feature}=()`);
    }
  });

  it("limits local connect sources to non-production CSP", async () => {
    const productionCsp = buildContentSecurityPolicy({
      nonce: "prod-nonce",
      nodeEnv: "production",
      chainEnv: "testnet",
    });
    const developmentCsp = buildContentSecurityPolicy({
      nonce: "dev-nonce",
      nodeEnv: "development",
      chainEnv: "devnet",
    });

    expect(productionCsp).not.toContain("http://localhost:*");
    expect(productionCsp).not.toContain("ws://localhost:*");
    expect(developmentCsp).toContain("http://localhost:*");
    expect(developmentCsp).toContain("ws://localhost:*");
  });

  it("keeps browser split chunks out of the server compiler", () => {
    const nextConfig = loadNextConfig("production");
    const serverSplitChunks = { chunks: "async" };
    const config = {
      resolve: { alias: {} },
      optimization: { splitChunks: serverSplitChunks },
      plugins: [],
    };

    const result = nextConfig.webpack(config, { isServer: true, dev: false });

    expect(result.optimization.splitChunks).toBe(serverSplitChunks);
  });
});
