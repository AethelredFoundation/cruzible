import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateProductionGapRegister } from "../../scripts/validate-production-gap-register.mjs";

type ProductionGapRow = {
  status: string;
};

describe("production gap register", () => {
  it("tracks at least fifty evidence-backed production gaps", () => {
    const markdown = readFileSync(
      "docs/architecture/13-production-gap-register.md",
      "utf8",
    );
    const { rows, errors } = validateProductionGapRegister(markdown);
    const gapRows = rows as ProductionGapRow[];

    expect(errors).toEqual([]);
    expect(gapRows.length).toBeGreaterThanOrEqual(50);
    expect(gapRows.some((row) => row.status === "In progress")).toBe(true);
    expect(gapRows.some((row) => row.status === "Blocked external")).toBe(true);
    expect(gapRows.some((row) => row.status === "Ready")).toBe(true);
  });
});
