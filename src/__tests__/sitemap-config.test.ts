import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("sitemap config", () => {
  it("keeps generated sitemap output deterministic for local and CI builds", () => {
    const config = require("../../next-sitemap.config.js") as {
      autoLastmod?: boolean;
      generateRobotsTxt?: boolean;
      exclude?: string[];
    };

    expect(config.autoLastmod).toBe(false);
    expect(config.generateRobotsTxt).toBe(false);
    expect(config.exclude).toContain("/devtools");
  });
});
