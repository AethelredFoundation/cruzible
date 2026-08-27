import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dockerignore = readFileSync(
  resolve(process.cwd(), ".dockerignore"),
  "utf8",
);

function expectIgnored(pattern: string) {
  expect(dockerignore).toMatch(new RegExp(`^${pattern}$`, "m"));
}

describe("Docker build context hardening", () => {
  it("excludes local credentials and secret material from image contexts", () => {
    for (const pattern of [
      String.raw`\.env`,
      String.raw`\.env\.\*`,
      String.raw`\.npmrc`,
      String.raw`\*\.key`,
      String.raw`\*\.pem`,
      String.raw`\*\.p12`,
      String.raw`\*\.pfx`,
      String.raw`\*\.crt`,
      String.raw`\*\.csr`,
      "secrets",
      String.raw`\*\*/secrets`,
    ]) {
      expectIgnored(pattern);
    }

    expect(dockerignore).toContain("!.env.example");
  });

  it("keeps generated and de-scoped workspaces out of root-context images", () => {
    for (const pattern of [
      String.raw`\.git`,
      String.raw`\.github`,
      "coverage",
      String.raw`\.turbo`,
      "target",
      "audit-artifacts",
      "reports",
      "backend/contracts",
      "backend/contracts/target",
      "backend/contracts/audit-artifacts",
      "backend/node",
      "backend/infra",
      "docs",
      "k8s",
    ]) {
      expectIgnored(pattern);
    }
  });
});
