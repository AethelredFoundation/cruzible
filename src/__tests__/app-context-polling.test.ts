import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("app shell polling", () => {
  it("deduplicates control-plane polling through the shared query key", () => {
    const appContext = readRepoFile("src/contexts/AppContext.tsx");
    const homePage = readRepoFile("src/pages/index.tsx");
    const reconciliation = readRepoFile("src/lib/reconciliation.ts");

    expect(reconciliation).toContain("RECONCILIATION_CONTROL_PLANE_QUERY_KEY");
    expect(appContext).toContain("RECONCILIATION_CONTROL_PLANE_QUERY_KEY");
    expect(homePage).toContain("RECONCILIATION_CONTROL_PLANE_QUERY_KEY");
    expect(appContext).not.toContain("window.setInterval");
    expect(appContext).not.toContain("refreshControlPlane");
  });

  it("keeps global block fallback polling on a bounded cadence", () => {
    const appContext = readRepoFile("src/contexts/AppContext.tsx");

    expect(appContext).toContain("watch: false");
    expect(appContext).toContain("refetchInterval: 30_000");
    expect(appContext).not.toContain("refetchInterval: 3_000");
  });
});
