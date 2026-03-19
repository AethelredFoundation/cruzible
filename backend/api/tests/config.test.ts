import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function loadConfigWithEnv(env: NodeJS.ProcessEnv) {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    ...env,
  };

  return import("../src/config");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("backend config hardening", () => {
  it("rejects development JWT secrets in production", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "production",
        CORS_ORIGINS: "https://app.cruzible.test",
        JWT_SECRET: "cruzible-dev-jwt-secret",
        JWT_REFRESH_SECRET: "cruzible-dev-refresh-secret",
      }),
    ).rejects.toThrow(
      "Refusing to start with development JWT secrets in production",
    );
  });

  it("rejects wildcard CORS in production", async () => {
    await expect(
      loadConfigWithEnv({
        NODE_ENV: "production",
        CORS_ORIGINS: "*",
        JWT_SECRET: "production-secret-123456",
        JWT_REFRESH_SECRET: "production-refresh-123456",
      }),
    ).rejects.toThrow(
      "Refusing to start with wildcard CORS origins in production",
    );
  });

  it("accepts explicit production-safe configuration", async () => {
    const { config } = await loadConfigWithEnv({
      NODE_ENV: "production",
      CORS_ORIGINS: "https://app.cruzible.test,https://admin.cruzible.test",
      JWT_SECRET: "production-secret-123456",
      JWT_REFRESH_SECRET: "production-refresh-123456",
      ALLOW_MOCK_SIGNATURES: "false",
    });

    expect(config.isProduction).toBe(true);
    expect(config.corsOrigins).toEqual([
      "https://app.cruzible.test",
      "https://admin.cruzible.test",
    ]);
  });
});
