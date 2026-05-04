import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../../next.config.js");

function loadNextConfig(nodeEnv: string) {
  delete require.cache[configPath];
  vi.stubEnv("NODE_ENV", nodeEnv);
  return require("../../next.config.js") as {
    images: { remotePatterns: Array<{ protocol: string; hostname: string }> };
  };
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
});
