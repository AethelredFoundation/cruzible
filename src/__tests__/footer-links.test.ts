import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sharedComponents = readFileSync(
  resolve(process.cwd(), "src/components/SharedComponents.tsx"),
  "utf8",
);

describe("footer production links", () => {
  it("does not ship placeholder footer links", () => {
    expect(sharedComponents).not.toContain('href: "#"');
    expect(sharedComponents).not.toContain('href="#"');
  });

  it("points footer resources at real product or repository-backed URLs", () => {
    expect(sharedComponents).toContain('href: "/vault"');
    expect(sharedComponents).toContain('href: "/reconciliation"');
    expect(sharedComponents).toContain(
      "https://github.com/aethelred-foundation/cruzible",
    );
    expect(sharedComponents).toContain("12-public-readiness.md");
    expect(sharedComponents).toContain("10-security-trust-model.md");
    expect(sharedComponents).toContain("AUDIT_PACKET.md");
  });
});
