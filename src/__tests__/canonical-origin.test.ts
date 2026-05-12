import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_APP_ORIGIN } from "@/components/SEOHead";

const repoRoot = process.cwd();

describe("canonical production origin", () => {
  it("keeps SEO metadata aligned with the public vault origin", () => {
    expect(CANONICAL_APP_ORIGIN).toBe("https://vault.aethelred.org");
  });

  it("uses the canonical origin and existing logo asset for wallet metadata", () => {
    const wagmiConfig = readFileSync(
      resolve(repoRoot, "src/config/wagmi.ts"),
      "utf8",
    );

    expect(wagmiConfig).toContain(
      'const APP_ORIGIN = "https://vault.aethelred.org"',
    );
    expect(wagmiConfig).toContain(
      "const APP_LOGO_URL = `${APP_ORIGIN}/cruzible-logo.png`",
    );
    expect(wagmiConfig).not.toContain("cruzible.aethelred.network/icon.png");
  });
});
