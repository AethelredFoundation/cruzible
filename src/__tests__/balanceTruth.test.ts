import { describe, expect, it } from "vitest";
import { classifyBalanceRead } from "@/lib/balanceTruth";

const updatedAt = Date.parse("2026-07-18T12:00:00.000Z");

describe("wallet balance truth", () => {
  it("marks a recent successful balance read available", () => {
    expect(
      classifyBalanceRead({
        hasValue: true,
        isLoading: false,
        isError: false,
        dataUpdatedAt: updatedAt,
        now: updatedAt + 10_000,
      }),
    ).toBe("available");
  });

  it("marks retained cached balance stale after an RPC error", () => {
    expect(
      classifyBalanceRead({
        hasValue: true,
        isLoading: false,
        isError: true,
        dataUpdatedAt: updatedAt,
        now: updatedAt + 10_000,
      }),
    ).toBe("stale");
  });

  it("marks an initial failed read unavailable instead of zero", () => {
    expect(
      classifyBalanceRead({
        hasValue: false,
        isLoading: false,
        isError: true,
        dataUpdatedAt: 0,
        now: updatedAt,
      }),
    ).toBe("unavailable");
  });
});
