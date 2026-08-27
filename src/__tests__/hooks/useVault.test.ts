import { needsTokenApproval } from "@/lib/allowance";

describe("vault transaction helpers", () => {
  it("requires token approval when allowance is missing or below the requested amount", () => {
    expect(needsTokenApproval(undefined, 1n)).toBe(true);
    expect(needsTokenApproval(99n, 100n)).toBe(true);
  });

  it("skips token approval when allowance already covers the requested amount", () => {
    expect(needsTokenApproval(100n, 100n)).toBe(false);
    expect(needsTokenApproval(101n, 100n)).toBe(false);
  });
});
