import { describe, it, expect } from "vitest";

import {
  buildValidatorEvidenceArtifact,
  stringifyValidatorEvidenceArtifact,
  buildValidatorEvidenceFilename,
  type ValidatorRecord,
  type ValidatorsProtocolContext,
} from "@/lib/validators";

function validator(overrides: Partial<ValidatorRecord> = {}): ValidatorRecord {
  return {
    address: "aeth1validatoraddress0000",
    moniker: "Atlas",
    identity: "id",
    website: "https://a",
    details: "d",
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

function protocolCtx(
  overrides: Partial<ValidatorsProtocolContext> = {},
): ValidatorsProtocolContext {
  return {
    totalBondedTokens: "4000",
    eligibleUniverseHash: "0xuniverse",
    snapshotAt: "2026-07-01T00:00:00Z",
    reconciliationStatus: "OK",
    freshnessStatus: "PASS",
    epoch: 42,
    epochSource: "indexer",
    epochLag: 0,
    indexedStateAgeSeconds: 12,
    staleLimitSeconds: 60,
    ...overrides,
  };
}

describe("buildValidatorEvidenceArtifact", () => {
  it("stamps the schema version", () => {
    const a = buildValidatorEvidenceArtifact(protocolCtx(), validator());
    expect(a.schema).toBe("cruzible.validator_evidence.v1");
  });

  it("uses the explicit generatedAt when provided", () => {
    const a = buildValidatorEvidenceArtifact(protocolCtx(), validator(), {
      generatedAt: "2026-07-12T00:00:00Z",
    });
    expect(a.generated_at).toBe("2026-07-12T00:00:00Z");
  });

  it("falls back generated_at to the snapshot timestamp", () => {
    const a = buildValidatorEvidenceArtifact(
      protocolCtx({ snapshotAt: "2026-06-01T00:00:00Z" }),
      validator(),
    );
    expect(a.generated_at).toBe("2026-06-01T00:00:00Z");
  });

  it("captures validator identity fields", () => {
    const a = buildValidatorEvidenceArtifact(
      protocolCtx(),
      validator({ moniker: "Nova" }),
    );
    expect(a.validator.address).toBe("aeth1validatoraddress0000");
    expect(a.validator.moniker).toBe("Nova");
    expect(a.validator.lifecycle_status).toBe("active");
  });

  it("labels an unnamed validator", () => {
    const a = buildValidatorEvidenceArtifact(
      protocolCtx(),
      validator({ moniker: "" }),
    );
    expect(a.validator.moniker).toBe("Unnamed validator");
  });

  it("computes economics from stake and commission", () => {
    const a = buildValidatorEvidenceArtifact(
      protocolCtx({ totalBondedTokens: "4000" }),
      validator({ tokens: "1000" }),
    );
    expect(a.economics.raw_stake).toBe("1000");
    expect(a.economics.total_bonded_tokens).toBe("4000");
    expect(a.economics.share_percent).toBe(25); // 1000/4000
    expect(a.economics.commission_percent).toBe(5);
    expect(a.economics.max_commission_percent).toBe(20);
    expect(a.economics.max_commission_change_percent).toBe(1);
  });

  it("mirrors protocol context in the protocol block", () => {
    const a = buildValidatorEvidenceArtifact(protocolCtx(), validator());
    expect(a.protocol.eligible_universe_hash).toBe("0xuniverse");
    expect(a.protocol.reconciliation_status).toBe("OK");
    expect(a.protocol.freshness_status).toBe("PASS");
    expect(a.protocol.epoch).toBe(42);
    expect(a.protocol.epoch_source).toBe("indexer");
  });

  it("defaults risk fields when the validator has no risk", () => {
    const a = buildValidatorEvidenceArtifact(protocolCtx(), validator());
    expect(a.risk.level).toBe("unknown");
    expect(a.risk.score).toBeNull();
    expect(a.risk.reasons).toEqual([]);
    expect(a.risk.components).toEqual([]);
  });

  it("builds a six-event timeline", () => {
    const a = buildValidatorEvidenceArtifact(protocolCtx(), validator());
    expect(a.timeline.map((t) => t.id)).toEqual([
      "snapshot",
      "freshness",
      "reconciliation",
      "epoch-source",
      "universe-hash",
      "risk-score",
    ]);
  });

  it("marks snapshot timeline event missing when no snapshot", () => {
    const a = buildValidatorEvidenceArtifact(
      protocolCtx({ snapshotAt: null }),
      validator(),
    );
    const snap = a.timeline.find((t) => t.id === "snapshot")!;
    expect(snap.status).toBe("missing");
    expect(snap.tone).toBe("warning");
  });

  it("marks universe-hash timeline event missing when absent", () => {
    const a = buildValidatorEvidenceArtifact(
      protocolCtx({ eligibleUniverseHash: undefined }),
      validator(),
    );
    const uh = a.timeline.find((t) => t.id === "universe-hash")!;
    expect(uh.status).toBe("missing");
  });

  it("derives share percent from stake when totalBondedTokens is missing", () => {
    const a = buildValidatorEvidenceArtifact(
      protocolCtx({ totalBondedTokens: undefined }),
      validator({ sharePercent: 12.5 }),
    );
    expect(a.economics.share_percent).toBe(12.5);
  });
});

describe("stringifyValidatorEvidenceArtifact", () => {
  it("produces indented JSON ending in a newline", () => {
    const a = buildValidatorEvidenceArtifact(protocolCtx(), validator());
    const s = stringifyValidatorEvidenceArtifact(a);
    expect(s.endsWith("\n")).toBe(true);
    expect(s).toContain('"schema": "cruzible.validator_evidence.v1"');
    expect(() => JSON.parse(s)).not.toThrow();
  });

  it("round-trips through JSON", () => {
    const a = buildValidatorEvidenceArtifact(protocolCtx(), validator());
    expect(JSON.parse(stringifyValidatorEvidenceArtifact(a))).toEqual(a);
  });
});

describe("buildValidatorEvidenceFilename", () => {
  it("builds a slugified filename from moniker and address prefix", () => {
    const name = buildValidatorEvidenceFilename(
      validator({ moniker: "Atlas Node", address: "aeth1abcdef0000" }),
    );
    expect(name).toBe(
      "cruzible-validator-evidence-atlas-node-aeth1abcdef0.json",
    );
  });

  it("falls back to 'validator' for an empty moniker", () => {
    const name = buildValidatorEvidenceFilename(
      validator({ moniker: "", address: "aeth1xyz000000000" }),
    );
    expect(name).toContain("cruzible-validator-evidence-validator-aeth1xyz00");
  });

  it("strips unsafe characters", () => {
    const name = buildValidatorEvidenceFilename(
      validator({ moniker: "A/B*C!", address: "aeth1abcdefabcdef" }),
    );
    expect(name).toMatch(/^cruzible-validator-evidence-[a-z0-9-]+\.json$/);
  });

  it("always ends with .json", () => {
    expect(buildValidatorEvidenceFilename(validator())).toMatch(/\.json$/);
  });
});
