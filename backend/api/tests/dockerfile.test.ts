import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");

function getProductionStage(): string {
  const productionStage = dockerfile
    .split(/^FROM base AS production$/m)
    .at(1)
    ?.split(/^# ============ INDEXER ============/m)
    .at(0);

  if (!productionStage) {
    throw new Error("Dockerfile production stage not found");
  }

  return productionStage;
}

describe("API Dockerfile hardening", () => {
  it("runs the production image through production config guards", () => {
    const productionStage = getProductionStage();

    expect(productionStage).toContain("ENV NODE_ENV=production");
    expect(productionStage).toContain("ENV PORT=4001");
    expect(productionStage).toContain("EXPOSE 4001");
    expect(productionStage).toContain("http://localhost:4001/health/live");
  });
});
