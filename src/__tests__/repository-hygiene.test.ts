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
});
