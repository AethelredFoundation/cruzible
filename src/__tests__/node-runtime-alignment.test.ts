import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readText(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

describe("Node runtime alignment", () => {
  it("keeps CI, containers, and package type surfaces on Node 20", () => {
    const rootPackage = readJson<{
      engines: { node: string };
      devDependencies: Record<string, string>;
    }>("package.json");
    const backendPackage = readJson<{ engines: { node: string } }>(
      "backend/api/package.json",
    );
    const sdkPackage = readJson<{ devDependencies: Record<string, string> }>(
      "sdk/typescript/package.json",
    );

    expect(rootPackage.engines.node).toBe(">=20.0.0");
    expect(backendPackage.engines.node).toBe(">=20.0.0");
    expect(rootPackage.devDependencies["@types/node"]).toMatch(/^\^20\./u);
    expect(sdkPackage.devDependencies["@types/node"]).toMatch(/^\^20\./u);
    expect(readText(".github/workflows/ci-cd.yml")).toContain(
      'NODE_VERSION: "20"',
    );
    expect(readText(".github/workflows/security-audit.yml")).toContain(
      'NODE_VERSION: "20"',
    );
    expect(readText("Dockerfile")).toContain("FROM node:20-alpine@");
    expect(readText("backend/api/Dockerfile")).toContain(
      "FROM node:20-alpine@",
    );
  });
});
