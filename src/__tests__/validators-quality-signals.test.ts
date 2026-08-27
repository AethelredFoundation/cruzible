import { describe, it, expect } from "vitest";

import {
  buildValidatorDataQualitySignals,
  type ValidatorRecord,
  type ValidatorsProtocolContext,
} from "@/lib/validators";

function protocolCtx(
  overrides: Partial<ValidatorsProtocolContext> = {},
): ValidatorsProtocolContext {
  return {
    freshnessStatus: "PASS",
    reconciliationStatus: "OK",
    snapshotAt: "2026-07-01T00:00:00Z",
    eligibleUniverseHash: "0xuniverse",
    epoch: 42,
    epochSource: "reconciliation-indexer",
    epochLag: 0,
    indexedStateAgeSeconds: 12,
    staleLimitSeconds: 60,
    ...overrides,
  };
}

function signalsFor(
  ctx?: Partial<ValidatorsProtocolContext>,
  validator?: ValidatorRecord,
) {
  return buildValidatorDataQualitySignals(
    ctx ? protocolCtx(ctx) : undefined,
    validator,
  );
}

function byId(
  signals: ReturnType<typeof buildValidatorDataQualitySignals>,
  id: string,
) {
  return signals.find((s) => s.id === id)!;
}

describe("buildValidatorDataQualitySignals — freshness", () => {
  it.each([
    ["PASS", "pass", "healthy"],
    ["WARNING", "warning", "warning"],
    ["SKIPPED", "skipped", "warning"],
    ["CRITICAL", "critical", "critical"],
    ["UNKNOWN", "unknown", "unknown"],
  ])("freshness %s -> %s/%s", (freshnessStatus, status, tone) => {
    const s = byId(
      signalsFor({ freshnessStatus: freshnessStatus as never }),
      "freshness",
    );
    expect(s.status).toBe(status);
    expect(s.tone).toBe(tone);
  });

  it("defaults freshness to unknown with no protocol context", () => {
    expect(byId(signalsFor(), "freshness").status).toBe("unknown");
  });

  it("uses the protocol freshnessMessage when provided", () => {
    const s = byId(
      signalsFor({ freshnessMessage: "custom detail" }),
      "freshness",
    );
    expect(s.detail).toBe("custom detail");
  });

  it("builds a default freshness detail from age and stale limit", () => {
    const s = byId(
      signalsFor({
        freshnessMessage: undefined,
        indexedStateAgeSeconds: 30,
        staleLimitSeconds: 90,
      }),
      "freshness",
    );
    expect(s.detail).toContain("30s"); // formatAgeSeconds(30)
    expect(s.detail).toContain("2m"); // formatAgeSeconds(90) rounds to 2m
  });
});

describe("buildValidatorDataQualitySignals — reconciliation", () => {
  it.each([
    ["OK", "ok", "healthy"],
    ["WARNING", "warning", "warning"],
    ["CRITICAL", "critical", "critical"],
    ["UNKNOWN", "unknown", "unknown"],
  ])("reconciliation %s -> %s/%s", (reconciliationStatus, status, tone) => {
    const s = byId(
      signalsFor({ reconciliationStatus: reconciliationStatus as never }),
      "reconciliation",
    );
    expect(s.status).toBe(status);
    expect(s.tone).toBe(tone);
  });
});

describe("buildValidatorDataQualitySignals — snapshot", () => {
  it("marks snapshot timestamped when present", () => {
    const s = byId(
      signalsFor({ snapshotAt: "2026-07-01T00:00:00Z" }),
      "snapshot",
    );
    expect(s.status).toBe("timestamped");
    expect(s.tone).toBe("healthy");
  });

  it("marks snapshot missing when absent", () => {
    const s = byId(signalsFor({ snapshotAt: null }), "snapshot");
    expect(s.status).toBe("missing");
    expect(s.tone).toBe("warning");
  });
});

describe("buildValidatorDataQualitySignals — universe hash", () => {
  it("available when the eligible universe hash is present", () => {
    expect(
      byId(signalsFor({ eligibleUniverseHash: "0xabc" }), "universe-hash")
        .status,
    ).toBe("available");
  });

  it("unavailable when missing", () => {
    const s = byId(
      signalsFor({ eligibleUniverseHash: undefined }),
      "universe-hash",
    );
    expect(s.status).toBe("unavailable");
    expect(s.tone).toBe("warning");
  });
});

describe("buildValidatorDataQualitySignals — epoch source", () => {
  it("shows current when epoch present with no lag", () => {
    const s = byId(
      signalsFor({ epoch: 42, epochSource: "indexer", epochLag: 0 }),
      "epoch-source",
    );
    expect(s.status).toBe("current");
    expect(s.tone).toBe("healthy");
  });

  it("shows the lag when epochLag > 0", () => {
    const s = byId(
      signalsFor({ epoch: 42, epochSource: "indexer", epochLag: 3 }),
      "epoch-source",
    );
    expect(s.status).toBe("lag 3");
    expect(s.tone).toBe("warning");
  });

  it("unavailable when epoch or source is missing", () => {
    const s = byId(
      signalsFor({ epoch: null, epochSource: undefined }),
      "epoch-source",
    );
    expect(s.status).toBe("unavailable");
    expect(s.tone).toBe("unknown");
  });
});

describe("buildValidatorDataQualitySignals — risk components", () => {
  function validator(risk?: ValidatorRecord["risk"]): ValidatorRecord {
    return {
      address: "aeth1v",
      moniker: "V",
      identity: "",
      website: "",
      details: "",
      tokens: "0",
      delegatorShares: "0",
      commission: { rate: "0", maxRate: "0", maxChangeRate: "0" },
      status: "BONDED",
      jailed: false,
      unbondingHeight: 0,
      unbondingTime: 0,
      risk,
    };
  }

  it("omits the risk-components signal when no validator is passed", () => {
    expect(
      signalsFor().find((s) => s.id === "risk-components"),
    ).toBeUndefined();
  });

  it("reports the number of checks when components exist", () => {
    const s = byId(
      signalsFor(
        {},
        validator({
          level: "low",
          score: 90,
          freshnessStatus: "PASS",
          reasons: [],
          components: [
            {
              key: "freshness",
              label: "Freshness",
              status: "PASS",
              value: "x",
              message: "m",
            },
            {
              key: "concentration",
              label: "Concentration",
              status: "PASS",
              value: "y",
              message: "m",
            },
          ],
        } as never),
      ),
      "risk-components",
    );
    expect(s.status).toBe("2 checks");
    expect(s.tone).toBe("healthy");
  });

  it("marks risk components missing when none returned", () => {
    const s = byId(signalsFor({}, validator(undefined)), "risk-components");
    expect(s.status).toBe("missing");
    expect(s.tone).toBe("warning");
  });

  it("prefers validator risk evidence over protocol context", () => {
    const s = byId(
      signalsFor(
        { freshnessStatus: "CRITICAL" },
        validator({
          level: "low",
          score: 90,
          freshnessStatus: "PASS",
          reasons: [],
          components: [],
          evidence: { indexedStateAgeSeconds: 5, staleLimitSeconds: 60 },
        } as never),
      ),
      "freshness",
    );
    // validator's own freshnessStatus (PASS) wins over protocol CRITICAL
    expect(s.status).toBe("pass");
  });
});

describe("buildValidatorDataQualitySignals — shape", () => {
  it("returns five base signals with no validator", () => {
    expect(signalsFor().map((s) => s.id)).toEqual([
      "freshness",
      "reconciliation",
      "snapshot",
      "universe-hash",
      "epoch-source",
    ]);
  });
});
