import { vi } from "vitest";

import {
  buildValidatorMetrics,
  fetchValidator,
  fetchValidators,
  formatAgeSeconds,
  formatRawTokenAmount,
  getCommissionPercent,
  getProfileCompleteness,
  getSharePercent,
  getValidatorSharePercent,
  getValidatorStatus,
  parseTokenAmount,
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
    commission: {
      rate: "0.05",
      maxRate: "0.2",
      maxChangeRate: "0.01",
    },
    status: "BOND_STATUS_BONDED",
    jailed: false,
    unbondingHeight: 0,
    unbondingTime: 0,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("validator formatting helpers", () => {
  it("derives lifecycle status from explicit, jailed, bonded, and inactive states", () => {
    expect(getValidatorStatus(validator({ lifecycleStatus: "inactive" }))).toBe(
      "inactive",
    );
    expect(getValidatorStatus(validator({ jailed: true }))).toBe("jailed");
    expect(getValidatorStatus(validator({ status: 3 }))).toBe("active");
    expect(getValidatorStatus(validator({ status: "UNBONDED" }))).toBe(
      "inactive",
    );
  });

  it("formats commission, token amounts, and age labels defensively", () => {
    expect(getCommissionPercent("0.075")).toBe(7.5);
    expect(getCommissionPercent("not-a-number")).toBe(0);
    expect(parseTokenAmount("123")).toBe(123n);
    expect(parseTokenAmount("bad")).toBe(0n);
    expect(formatRawTokenAmount("1234567890123")).toBe("1.23T");
    expect(formatRawTokenAmount("1234567")).toBe("1.23M");
    expect(formatRawTokenAmount("1234")).toBe("1.23K");
    expect(formatRawTokenAmount("00042")).toBe("42");
    expect(formatAgeSeconds(null)).toBe("Unavailable");
    expect(formatAgeSeconds(Number.NaN)).toBe("Unavailable");
    expect(formatAgeSeconds(45)).toBe("45s");
    expect(formatAgeSeconds(180)).toBe("3m");
    expect(formatAgeSeconds(7_200)).toBe("2h");
  });

  it("computes share and profile completeness with overrides when present", () => {
    expect(getSharePercent("250", 1_000n)).toBe(25);
    expect(getSharePercent(0n, 1_000n)).toBe(0);
    expect(getSharePercent("250", 0n)).toBe(0);
    expect(
      getValidatorSharePercent(validator({ sharePercent: 12.5 }), 1_000n),
    ).toBe(12.5);
    expect(getValidatorSharePercent(validator({ tokens: "250" }), 1_000n)).toBe(
      25,
    );
    expect(getProfileCompleteness(validator({ transparencyScore: 88 }))).toBe(
      88,
    );
    expect(
      getProfileCompleteness(
        validator({ website: "", details: "", identity: "id" }),
      ),
    ).toBe(55);
  });
});

describe("buildValidatorMetrics", () => {
  it("summarizes validator set health and stake concentration", () => {
    const metrics = buildValidatorMetrics(
      [
        validator({ moniker: "Alpha", tokens: "600", commissionPercent: 6 }),
        validator({
          moniker: "Beta",
          tokens: "300",
          identity: "",
          website: "",
          jailed: true,
          commission: { rate: "0.1", maxRate: "0.2", maxChangeRate: "0.01" },
        }),
        validator({
          moniker: "Gamma",
          tokens: "100",
          status: "UNBONDED",
          details: "",
          commission: { rate: "0.03", maxRate: "0.2", maxChangeRate: "0.01" },
        }),
      ],
      { totalStakeOverride: "1000" },
    );

    expect(metrics).toMatchObject({
      activeCount: 1,
      jailedCount: 1,
      identityCoverage: 67,
      websiteCoverage: 67,
      topTenShare: 100,
      nakamoto33: 1,
      totalStake: 1000n,
    });
    expect(metrics.averageCommission).toBeCloseTo(6.33, 2);
  });
});

describe("validator API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches validators with query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [],
        pagination: { limit: 10, offset: 5, total: 0, hasMore: false },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchValidators({
      limit: 10,
      offset: 5,
      status: "active",
    });

    expect(response.data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/v1/validators?limit=10&offset=5&status=active",
    );
  });

  it("returns direct validator detail responses and wrapped responses", async () => {
    const direct = validator({ address: "aeth1direct" });
    const wrapped = { validator: validator({ address: "aeth1wrapped" }) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(direct))
      .mockResolvedValueOnce(jsonResponse(wrapped));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchValidator("aeth1direct")).resolves.toEqual({
      validator: direct,
    });
    await expect(fetchValidator("aeth1wrapped")).resolves.toEqual(wrapped);
  });

  it("falls back to the list endpoint when detail lookup misses", async () => {
    const fallback = validator({ address: "aeth1fallback" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [fallback],
          pagination: { limit: 200, offset: 0, total: 1, hasMore: false },
          protocol: { reconciliationStatus: "OK" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchValidator("aeth1fallback")).resolves.toEqual({
      validator: fallback,
      protocol: { reconciliationStatus: "OK" },
    });
  });

  it("raises clear errors for failed list and missing fallback responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, { status: 503 })),
    );
    await expect(fetchValidators()).rejects.toThrow(
      "Failed to fetch validators",
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [],
          pagination: { limit: 200, offset: 0, total: 0, hasMore: false },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchValidator("missing")).rejects.toThrow(
      "Validator not found",
    );
  });
});
