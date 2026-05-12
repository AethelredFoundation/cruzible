import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiDockerfile = readFileSync(
  resolve(process.cwd(), "backend/api/Dockerfile"),
  "utf8",
);

describe("backend API Dockerfile hardening", () => {
  it("keeps native build tooling out of the production stage", () => {
    const dependenciesStage = apiDockerfile
      .split("FROM base AS dependencies")
      .at(1);
    const productionStage = apiDockerfile
      .split("FROM base AS production")
      .at(1);

    expect(dependenciesStage).toBeDefined();
    expect(dependenciesStage).toContain("apk add --no-cache python3 make g++");

    expect(productionStage).toBeDefined();
    expect(productionStage).not.toContain("python3");
    expect(productionStage).not.toContain(" make ");
    expect(productionStage).not.toContain("g++");
  });

  it("runs with a non-root production user and init process", () => {
    expect(apiDockerfile).toContain(
      "apk add --no-cache dumb-init curl libstdc++",
    );
    expect(apiDockerfile).toContain("ENV NODE_ENV=production");
    expect(apiDockerfile).toContain("USER nodejs");
    expect(apiDockerfile).toContain('ENTRYPOINT ["dumb-init", "--"]');
  });
});
