import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const prepareScript = readFileSync(
  resolve(process.cwd(), "scripts/prepare-next-standalone.mjs"),
  "utf8",
);

describe("Next.js standalone preparation", () => {
  it("copies production static and public assets into the standalone server", () => {
    expect(prepareScript).toContain('join(".next", "standalone")');
    expect(prepareScript).toContain('join(".next", "static")');
    expect(prepareScript).toContain('join(standaloneDir, ".next", "static")');
    expect(prepareScript).toContain("standalonePublicDir");
    expect(prepareScript).toContain("cpSync");
    expect(prepareScript).toContain("Next.js static assets are required");
  });
});
