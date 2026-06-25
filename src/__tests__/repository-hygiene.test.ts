import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("repository hygiene", () => {
  it("keeps the pre-commit quality gate executable", () => {
    const indexEntry = execFileSync(
      "git",
      ["ls-files", "--stage", ".husky/pre-commit"],
      { encoding: "utf8" },
    );

    expect(indexEntry).toMatch(/^100755 /);
  });

  it("only restores pre-commit stashes created by the hook", () => {
    const hook = readFileSync(".husky/pre-commit", "utf8");

    expect(hook).toContain("STASH_CREATED=0");
    expect(hook).toContain("trap restore_stash EXIT");
    expect(hook).toContain("if ! git diff --quiet; then");
    expect(hook).toContain(
      'git stash push -q --keep-index -m "cruzible-pre-commit-unstaged"',
    );
    expect(hook).toContain('if [ "$STASH_CREATED" -eq 1 ]; then');
    expect(hook).not.toContain("git stash -q --keep-index");
    expect(hook).not.toMatch(/^git stash pop -q$/m);
  });

  it("passes staged files into the related-test pre-commit gate", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const runner = readFileSync("scripts/run-related-tests.mjs", "utf8");

    expect(packageJson.scripts["test:changed"]).toBe(
      "node scripts/run-related-tests.mjs",
    );
    expect(runner).toContain("git");
    expect(runner).toContain("--cached");
    expect(runner).toContain("vitest");
    expect(runner).toContain("related");
    expect(runner).toContain("FULL_TEST_TRIGGER_PATHS");
    expect(runner).toContain('"next-sitemap.config.js"');
    expect(runner).toContain('"src/pages/"');
  });

  it("routes staged backend API changes through backend quality gates", () => {
    const runner = readFileSync("scripts/run-related-tests.mjs", "utf8");

    expect(runner).toContain('const BACKEND_API_PREFIX = "backend/api/"');
    expect(runner).toContain("BACKEND_API_VALIDATION_STEPS");
    expect(runner).toContain("runBackendApiValidation");
    expect(runner).toContain('"format:check"');
    expect(runner).toContain('"typecheck"');
    expect(runner).toContain('runInDirectory(command, args, "backend/api")');
  });

  it("routes staged E2E changes through production smoke tests", () => {
    const runner = readFileSync("scripts/run-related-tests.mjs", "utf8");

    expect(runner).toContain('const E2E_PREFIX = "e2e/"');
    expect(runner).toContain("shouldRunE2eSuite");
    expect(runner).toContain('filePath === "playwright.config.ts"');
    expect(runner).toContain('"test:e2e"');
    expect(runner).toContain("!filePath.startsWith(E2E_PREFIX)");
  });

  it("keeps accessibility readiness checks in the production E2E suite", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const accessibilitySpec = readFileSync(
      "e2e/accessibility-readiness.spec.ts",
      "utf8",
    );
    const workflow = readFileSync(".github/workflows/ci-cd.yml", "utf8");

    expect(packageJson.scripts["accessibility:check"]).toBe(
      "playwright test e2e/accessibility-readiness.spec.ts --project=chromium",
    );
    expect(packageJson.scripts["test:e2e"]).toBe("playwright test");
    expect(workflow).toContain("npm run test:e2e");
    expect(accessibilitySpec).toContain("assertPageAccessibility");
    expect(accessibilitySpec).toContain(
      "Visible form fields must be associated with a label or aria label.",
    );
    expect(accessibilitySpec).toContain("main#main-content");
  });

  it("keeps the production gap register in local and CI quality gates", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const securityWorkflow = readFileSync(
      ".github/workflows/security-audit.yml",
      "utf8",
    );

    expect(packageJson.scripts["readiness:gaps"]).toBe(
      "node scripts/validate-production-gap-register.mjs",
    );
    expect(packageJson.scripts.validate).toContain("npm run readiness:gaps");
    expect(packageJson.scripts["verify:ci"]).toContain(
      "npm run readiness:gaps",
    );
    expect(securityWorkflow).toContain("Validate production gap register");
    expect(securityWorkflow).toContain("npm run readiness:gaps");
  });

  it("keeps the public route inventory in local and CI quality gates", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const securityWorkflow = readFileSync(
      ".github/workflows/security-audit.yml",
      "utf8",
    );

    expect(packageJson.scripts["readiness:routes"]).toBe(
      "node scripts/validate-public-route-inventory.mjs",
    );
    expect(packageJson.scripts.validate).toContain("npm run readiness:routes");
    expect(packageJson.scripts["verify:ci"]).toContain(
      "npm run readiness:routes",
    );
    expect(securityWorkflow).toContain("Validate public route inventory");
    expect(securityWorkflow).toContain("npm run readiness:routes");
  });
});
