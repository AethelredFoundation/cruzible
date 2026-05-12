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
});
