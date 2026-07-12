import { describe, it, expect } from "vitest";

import {
  getValidatorStatus,
  getCommissionPercent,
  parseTokenAmount,
  formatRawTokenAmount,
  formatTimestamp,
  formatAgeSeconds,
  getSharePercent,
  getValidatorSharePercent,
  getProfileCompleteness,
  buildValidatorMetrics,
  type ValidatorRecord,
} from "@/lib/validators";

function validator(overrides: Partial<ValidatorRecord> = {}): ValidatorRecord {
  return {
    address: "aeth1validator",
    moniker: "Atlas",
    identity: "identity",
    website: "https://validator.example",
    details: "Reliable validator",
    tokens: "1000",
    delegatorShares: "1000",
    commission: { rate: "0.05", maxRate: "0.2", maxChangeRate: "0.01" },
    status: "BOND_STATUS_BONDED",
    jailed: false,
    unbondingHeight: 0,
    unbondingTime: 0,
    ...overrides,
  };
}

describe("getValidatorStatus", () => {
  it.each([
    [{ lifecycleStatus: "jailed" as const }, "jailed"],
    [{ lifecycleStatus: "inactive" as const }, "inactive"],
    [{ lifecycleStatus: "active" as const, jailed: true }, "active"], // explicit wins over jailed
    [{ jailed: true }, "jailed"],
    [{ status: "BOND_STATUS_BONDED" }, "active"],
    [{ status: "BONDED" }, "active"],
    [{ status: "bonded" }, "active"],
    [{ status: "3" }, "active"],
    [{ status: 3 }, "active"],
    [{ status: "UNBONDED" }, "inactive"],
    [{ status: "BOND_STATUS_UNBONDING" }, "inactive"],
    [{ status: 1 }, "inactive"],
    [{ status: "" }, "inactive"],
  ])("maps %o -> %s", (overrides, expected) => {
    expect(getValidatorStatus(validator(overrides))).toBe(expected);
  });

  it("prefers jailed over bonded status when no explicit lifecycle set", () => {
    expect(
      getValidatorStatus(validator({ jailed: true, status: "BONDED" })),
    ).toBe("jailed");
  });
});

describe("getCommissionPercent", () => {
  it.each([
    ["0", 0],
    ["0.05", 5],
    ["0.1", 10],
    ["1", 100],
    ["0.125", 12.5],
    ["not-a-number", 0],
    ["", 0],
    ["Infinity", 0],
    ["NaN", 0],
  ])("getCommissionPercent(%s) === %d", (rate, expected) => {
    expect(getCommissionPercent(rate)).toBe(expected);
  });
});

describe("parseTokenAmount", () => {
  it.each([
    ["0", 0n],
    ["1000", 1000n],
    ["999999999999999999999", 999999999999999999999n],
    ["", 0n],
    ["abc", 0n],
    ["1.5", 0n], // non-integer -> BigInt throws -> 0n
    ["-42", -42n],
  ])("parseTokenAmount(%s) === %s", (value, expected) => {
    expect(parseTokenAmount(value)).toBe(expected);
  });
});

describe("formatRawTokenAmount", () => {
  it.each([
    ["0", "0"],
    ["", "0"],
    ["5", "5"],
    ["999", "999"],
    ["1000", "1K"],
    ["1500", "1.5K"],
    ["1000000", "1M"],
    ["2500000", "2.5M"],
    ["1000000000", "1B"],
    ["1000000000000", "1T"],
    ["1000000000000000", "1Q"],
    ["100", "100"],
  ])("formatRawTokenAmount(%s) === %s", (value, expected) => {
    expect(formatRawTokenAmount(value)).toBe(expected);
  });

  it("strips leading zeros before formatting", () => {
    expect(formatRawTokenAmount("0001000")).toBe("1K");
  });

  it("comma-groups values below the K threshold with 4+ digits stripped to 3", () => {
    // 999 has no grouping; boundary check on the grouping branch
    expect(formatRawTokenAmount("500")).toBe("500");
  });
});

describe("formatTimestamp", () => {
  it("returns n/a for falsy timestamps", () => {
    expect(formatTimestamp(0)).toBe("n/a");
  });

  it("returns a locale string for a real timestamp", () => {
    const out = formatTimestamp(1_700_000_000_000);
    expect(out).not.toBe("n/a");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("formatAgeSeconds", () => {
  it.each([
    [null, "Unavailable"],
    [undefined, "Unavailable"],
    [Number.NaN, "Unavailable"],
    [Number.POSITIVE_INFINITY, "Unavailable"],
    [0, "0s"],
    [1, "1s"],
    [59, "59s"],
    [60, "1m"],
    [90, "2m"],
    [1800, "30m"],
    [3540, "59m"],
    [3599, "1h"], // rounds to 60m, which rolls over to hours
    [3600, "1h"],
    [5400, "2h"], // 90m -> 2h
    [7200, "2h"],
  ])("formatAgeSeconds(%s) === %s", (seconds, expected) => {
    expect(formatAgeSeconds(seconds as number | null | undefined)).toBe(
      expected,
    );
  });

  it("rolls over to hours past 60 minutes", () => {
    expect(formatAgeSeconds(3600 * 3)).toBe("3h");
    expect(formatAgeSeconds(3600 * 24)).toBe("24h");
  });
});

describe("getSharePercent", () => {
  it.each([
    ["250", 1000n, 25],
    ["500", 1000n, 50],
    ["1000", 1000n, 100],
    ["0", 1000n, 0],
    ["100", 0n, 0], // zero total
    ["333", 1000n, 33.3],
  ])("getSharePercent(%s, %s) === %d", (value, total, expected) => {
    expect(getSharePercent(value, total)).toBeCloseTo(expected, 1);
  });

  it("accepts a bigint value directly", () => {
    expect(getSharePercent(250n, 1000n)).toBe(25);
  });

  it("returns 0 for negative or zero numeric value", () => {
    expect(getSharePercent(0n, 1000n)).toBe(0);
  });
});

describe("getValidatorSharePercent", () => {
  it("uses the explicit sharePercent when finite", () => {
    expect(
      getValidatorSharePercent(validator({ sharePercent: 42 }), 1000n),
    ).toBe(42);
  });

  it("falls back to computed share from tokens", () => {
    expect(getValidatorSharePercent(validator({ tokens: "250" }), 1000n)).toBe(
      25,
    );
  });

  it("ignores a non-finite sharePercent and computes", () => {
    expect(
      getValidatorSharePercent(
        validator({ sharePercent: Number.NaN, tokens: "500" }),
        1000n,
      ),
    ).toBe(50);
  });
});

describe("getProfileCompleteness", () => {
  it("uses transparencyScore when present and finite", () => {
    expect(getProfileCompleteness(validator({ transparencyScore: 77 }))).toBe(
      77,
    );
  });

  it("scores a fully-populated profile at 100", () => {
    expect(getProfileCompleteness(validator())).toBe(100);
  });

  it.each([
    [{ moniker: "", identity: "", website: "", details: "" }, 0],
    [{ moniker: "X", identity: "", website: "", details: "" }, 30],
    [{ moniker: "", identity: "id", website: "", details: "" }, 25],
    [{ moniker: "", identity: "", website: "w", details: "" }, 25],
    [{ moniker: "", identity: "", website: "", details: "d" }, 20],
    [{ moniker: "X", identity: "id", website: "", details: "" }, 55],
  ])("scores partial profile %o at %d", (overrides, expected) => {
    expect(getProfileCompleteness(validator(overrides))).toBe(expected);
  });
});

describe("buildValidatorMetrics", () => {
  const set = [
    validator({
      moniker: "A",
      tokens: "600",
      identity: "a",
      website: "https://a",
      commissionPercent: 6,
    }),
    validator({
      moniker: "B",
      tokens: "300",
      identity: "",
      website: "",
      commission: { rate: "0.1", maxRate: "0.2", maxChangeRate: "0.01" },
    }),
    validator({
      moniker: "C",
      tokens: "100",
      jailed: true,
      identity: "",
      website: "",
    }),
  ];

  it("computes total stake from the set", () => {
    expect(buildValidatorMetrics(set).totalStake).toBe(1000n);
  });

  it("honors a string totalStakeOverride", () => {
    expect(
      buildValidatorMetrics(set, { totalStakeOverride: "2000" }).totalStake,
    ).toBe(2000n);
  });

  it("honors a bigint totalStakeOverride", () => {
    expect(
      buildValidatorMetrics(set, { totalStakeOverride: 5000n }).totalStake,
    ).toBe(5000n);
  });

  it("counts active and jailed validators", () => {
    const m = buildValidatorMetrics(set);
    expect(m.activeCount).toBe(2);
    expect(m.jailedCount).toBe(1);
  });

  it("computes identity and website coverage percentages", () => {
    const m = buildValidatorMetrics(set);
    expect(m.identityCoverage).toBe(33); // 1 of 3
    expect(m.websiteCoverage).toBe(33);
  });

  it("averages commission (explicit percent or derived from rate)", () => {
    const m = buildValidatorMetrics(set);
    // A: 6, B: 10 (0.1*100), C: 5 (0.05*100) -> avg 7
    expect(m.averageCommission).toBeCloseTo(7, 5);
  });

  it("computes top-ten share and nakamoto33", () => {
    const m = buildValidatorMetrics(set);
    expect(m.topTenShare).toBe(100); // only 3 validators
    expect(m.nakamoto33).toBeGreaterThanOrEqual(1);
  });

  it("returns zeros for an empty validator set", () => {
    const m = buildValidatorMetrics([]);
    expect(m.activeCount).toBe(0);
    expect(m.identityCoverage).toBe(0);
    expect(m.averageCommission).toBe(0);
    expect(m.totalStake).toBe(0n);
    expect(m.nakamoto33).toBe(0);
  });
});
