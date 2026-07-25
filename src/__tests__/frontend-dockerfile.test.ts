import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FRONTEND_PUBLIC_BUILD_KEYS } from "../../scripts/lib/frontend-public-env-keys.mjs";

const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

describe("frontend Dockerfile hardening", () => {
  it("requires public build args instead of defaulting production images", () => {
    const dockerPublicArgs = [
      ...dockerfile.matchAll(/^ARG (NEXT_PUBLIC_\S+)$/gmu),
    ]
      .map((match) => match[1])
      .sort();
    expect(dockerPublicArgs).toEqual([...FRONTEND_PUBLIC_BUILD_KEYS].sort());
    for (const buildArg of FRONTEND_PUBLIC_BUILD_KEYS) {
      expect(dockerfile).toContain(`ARG ${buildArg}`);
      expect(dockerfile).toContain(`ENV ${buildArg}=\${${buildArg}}`);
    }
    expect(dockerfile).not.toContain("ARG NEXT_PUBLIC_CHAIN_ENV=testnet");
    expect(dockerfile).toContain("NEXT_PUBLIC_API_URL build arg is required");
    expect(dockerfile).toContain("NEXT_PUBLIC_CHAIN_ENV build arg is required");
    expect(dockerfile).toContain(
      "NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL build arg is required for testnet",
    );
    expect(dockerfile).toContain(
      "NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID build arg is required for mainnet",
    );
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
    expect(runnerStage).toContain('ENV CRUZIBLE_EXTRA_API_ORIGINS=""');
    expect(runnerStage).toContain('ENV CRUZIBLE_ALLOW_PLAINTEXT_HTTP="false"');
  });

  it("runs the production server behind an init process with a healthcheck", () => {
    expect(dockerfile).toContain(
      "RUN apk add --no-cache --upgrade dumb-init libcrypto3 libssl3",
    );
    expect(dockerfile).toContain('ENTRYPOINT ["dumb-init", "--"]');
    expect(dockerfile).toContain(
      "HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3",
    );
    expect(dockerfile).toContain("http://127.0.0.1:3000/api/health");
  });

  it("installs dependencies without package lifecycle scripts", () => {
    expect(dockerfile).toContain("RUN npm ci --no-fund --ignore-scripts");
    expect(dockerfile).toContain("RUN npm rebuild sharp --no-fund");
    expect(dockerfile).not.toContain("RUN npm ci --no-fund\n");
  });
});
