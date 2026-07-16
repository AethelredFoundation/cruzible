import { describe, it, expect } from "vitest";
import {
  bufferGasLimit,
  GAS_BUFFER_MULTIPLIER,
  GAS_FLOOR,
  GAS_CEILING,
} from "@/lib/gas";

describe("bufferGasLimit", () => {
  it("applies the floor when the estimate is near-intrinsic (the real bug)", () => {
    // registerIdentity estimates ~23,690 but really needs ~90k–200k.
    // 23,690 * 8 = 189,520 < the 700k floor, so the floor covers it.
    expect(bufferGasLimit(23_690n)).toBe(GAS_FLOOR);
    expect(bufferGasLimit(23_690n) > 200_000n).toBe(true);
  });

  it("multiplies larger estimates so bigger calls scale", () => {
    // 150k * 8 = 1.2M, above the floor.
    expect(bufferGasLimit(150_000n)).toBe(150_000n * GAS_BUFFER_MULTIPLIER);
  });

  it("never exceeds the ceiling", () => {
    expect(bufferGasLimit(10_000_000n)).toBe(GAS_CEILING);
  });

  it("handles a zero estimate by returning the floor, never zero", () => {
    expect(bufferGasLimit(0n)).toBe(GAS_FLOOR);
  });
});
