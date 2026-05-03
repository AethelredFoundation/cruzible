import { describe, expect, it } from "vitest";
import { isDevtoolsEnabled } from "@/config/features";

describe("feature gates", () => {
  it("enables devtools outside production for local diagnostics", () => {
    expect(isDevtoolsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isDevtoolsEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("hides devtools in production unless explicitly enabled", () => {
    expect(isDevtoolsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      isDevtoolsEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "false",
      }),
    ).toBe(false);
    expect(
      isDevtoolsEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_ENABLE_DEVTOOLS: "true",
      }),
    ).toBe(true);
  });
});
