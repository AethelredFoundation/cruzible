import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

describe("frontend Dockerfile hardening", () => {
  it("requires public build args instead of defaulting production images", () => {
    for (const buildArg of [
      "NEXT_PUBLIC_API_URL",
      "NEXT_PUBLIC_CHAIN_ENV",
      "NEXT_PUBLIC_CRUZIBLE_ADDRESS",
      "NEXT_PUBLIC_STAETHEL_ADDRESS",
      "NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS",
      "NEXT_PUBLIC_GOVERNANCE_ADDRESS",
      "NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS",
      "NEXT_PUBLIC_USDC_TOKEN_ADDRESS",
      "NEXT_PUBLIC_USDT_TOKEN_ADDRESS",
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    ]) {
      expect(dockerfile).toContain(`ARG ${buildArg}`);
      expect(dockerfile).toContain(`ENV ${buildArg}=\${${buildArg}}`);
    }
    expect(dockerfile).not.toContain("ARG NEXT_PUBLIC_CHAIN_ENV=testnet");
    expect(dockerfile).toContain("NEXT_PUBLIC_API_URL build arg is required");
    expect(dockerfile).toContain("NEXT_PUBLIC_CHAIN_ENV build arg is required");
  });

  it("does not expose compiled public config as mutable runtime env", () => {
    const runnerStage = dockerfile
      .split(
        "FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner",
      )
      .at(1);

    expect(runnerStage).toBeDefined();
    expect(runnerStage).not.toContain("ENV NEXT_PUBLIC_API_URL");
    expect(runnerStage).not.toContain("ENV NEXT_PUBLIC_CHAIN_ENV");
  });

  it("runs the production server behind an init process with a healthcheck", () => {
    expect(dockerfile).toContain("RUN apk add --no-cache dumb-init");
    expect(dockerfile).toContain('ENTRYPOINT ["dumb-init", "--"]');
    expect(dockerfile).toContain(
      "HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3",
    );
    expect(dockerfile).toContain("http://127.0.0.1:3000/api/health");
  });
});
