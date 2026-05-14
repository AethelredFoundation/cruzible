import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const gitignore = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8");

describe("gitignore secret hardening", () => {
  it("keeps local environment overrides ignored while preserving examples", () => {
    expect(gitignore).toContain(".env*");
    expect(gitignore).toContain("!.env.example");
    expect(gitignore).toContain("!backend/.env.example");
  });

  it("keeps local secret directories and TLS material out of version control", () => {
    for (const pattern of [
      "secrets/",
      "**/secrets/",
      "*.key",
      "*.pem",
      "*.p12",
      "*.pfx",
      "*.crt",
      "*.csr",
    ]) {
      expect(gitignore).toContain(pattern);
    }
  });

  it("keeps Python runtime caches out of version control", () => {
    expect(gitignore).toContain(".pytest_cache/");
    expect(gitignore).toContain("__pycache__/");
    expect(gitignore).toContain("*.py[cod]");
    expect(gitignore).toContain("build/");
    expect(gitignore).toContain("*.egg-info/");
  });

  it("keeps backend API build output out of version control", () => {
    expect(gitignore).toContain("backend/api/dist/");
  });
});
