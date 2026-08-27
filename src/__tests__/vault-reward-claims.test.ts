import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const vaultPage = readFileSync(
  resolve(process.cwd(), "src/pages/vault/index.tsx"),
  "utf8",
);

describe("vault reward-claim release gate", () => {
  it("does not expose a claim action until the authoritative proof API exists", () => {
    expect(vaultPage).not.toContain("/vault/reward-proof");
    expect(vaultPage).not.toContain("Fetch & Claim Proof");
    expect(vaultPage).toContain("Proof pipeline not deployed");
    expect(vaultPage).toContain("Claims unavailable");
    expect(vaultPage).toContain(
      "Reward claims are disabled until an authoritative allocation source",
    );
  });
});
