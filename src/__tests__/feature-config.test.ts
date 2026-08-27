import { describe, expect, it } from "vitest";
import { getDevtoolsServiceUrls } from "@/config/devtools";
import { isDevtoolsEnabled } from "@/config/features";

describe("feature gates", () => {
  it("keeps devtools disabled unless explicitly enabled outside production", () => {
    expect(isDevtoolsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isDevtoolsEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(
      isDevtoolsEnabled({
        NODE_ENV: "development",
        NEXT_PUBLIC_CHAIN_ENV: "devnet",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
      }),
    ).toBe(true);
    expect(
      isDevtoolsEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_CHAIN_ENV: "devnet",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
      }),
    ).toBe(true);
    expect(
      isDevtoolsEnabled({
        NODE_ENV: "development",
        NEXT_PUBLIC_CHAIN_ENV: "testnet",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
      }),
    ).toBe(false);
  });

  it("hides devtools in production even when public flags are set", () => {
    expect(isDevtoolsEnabled({})).toBe(false);
    expect(isDevtoolsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      isDevtoolsEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "false",
      }),
    ).toBe(false);
    expect(
      isDevtoolsEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
      }),
    ).toBe(false);
  });

  it("allows local diagnostics to stay disabled explicitly", () => {
    expect(
      isDevtoolsEnabled({
        NODE_ENV: "development",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "false",
      }),
    ).toBe(false);
  });

  it("normalizes devtools service URLs to local origins", () => {
    expect(
      getDevtoolsServiceUrls({
        NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL: "http://localhost:8000/",
        NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL: "https://127.0.0.1:3000",
        NEXT_PUBLIC_DEVTOOLS_RPC_URL: "http://[::1]:26657/",
      }),
    ).toEqual({
      fastapi: "http://localhost:8000",
      nextjs: "https://127.0.0.1:3000",
      rpc: "http://[::1]:26657",
    });
  });

  it("rejects non-local devtools service URLs", () => {
    expect(() =>
      getDevtoolsServiceUrls({
        NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL: "https://verifier.example.com",
      }),
    ).toThrow("NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL must point to localhost");
  });

  it("rejects devtools service URLs with credentials or request material", () => {
    expect(() =>
      getDevtoolsServiceUrls({
        NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL: "http://user:pass@localhost:3000",
      }),
    ).toThrow("NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL must not include credentials");

    expect(() =>
      getDevtoolsServiceUrls({
        NEXT_PUBLIC_DEVTOOLS_RPC_URL: "http://localhost:26657/status?token=x",
      }),
    ).toThrow(
      "NEXT_PUBLIC_DEVTOOLS_RPC_URL must not include query strings or fragments",
    );
  });
});
