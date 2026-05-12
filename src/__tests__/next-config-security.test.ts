import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  };
}

async function getGlobalSecurityHeader(name: string, nodeEnv = "production") {
  const nextConfig = loadNextConfig(nodeEnv);
  const headerRules = await nextConfig.headers();
  const globalRule = headerRules.find((rule) => rule.source === "/:path*");
  return globalRule?.headers.find((header) => header.key === name)?.value;
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
    const csp = await getGlobalSecurityHeader("Content-Security-Policy");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("https://api.aethelred.io");
    expect(csp).toContain("https://api.testnet.aethelred.org");
    expect(csp).toContain("wss://evm-ws-testnet.aethelred.network");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("sets browser isolation and legacy plugin blocking headers", async () => {
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

  it("limits local connect sources to non-production CSP", async () => {
    const productionCsp = await getGlobalSecurityHeader(
      "Content-Security-Policy",
      "production",
    );
    const developmentCsp = await getGlobalSecurityHeader(
      "Content-Security-Policy",
      "development",
    );

    expect(productionCsp).not.toContain("http://localhost:*");
    expect(productionCsp).not.toContain("ws://localhost:*");
    expect(developmentCsp).toContain("http://localhost:*");
    expect(developmentCsp).toContain("ws://localhost:*");
  });
});
