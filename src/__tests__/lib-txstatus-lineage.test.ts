import { describe, it, expect } from "vitest";

import {
  txStatusLabel,
  txStatusColor,
  type TxStatus,
} from "@/hooks/useTransaction";
import { getSealLineageCompleteness, type SealDetailRecord } from "@/lib/seals";

describe("useTransaction txStatusLabel", () => {
  it.each<[TxStatus, string]>([
    ["idle", ""],
    ["awaiting_signature", "Awaiting wallet signature..."],
    ["pending", "Transaction submitted, waiting for confirmation..."],
    ["confirming", "Transaction included, confirming..."],
    ["confirmed", "Transaction confirmed!"],
    ["reverted", "Transaction reverted"],
    ["rejected", "Transaction rejected in wallet"],
    ["error", "Transaction failed"],
  ])("txStatusLabel(%s) === %s", (status, expected) => {
    expect(txStatusLabel(status)).toBe(expected);
  });
});

describe("useTransaction txStatusColor", () => {
  it.each<[TxStatus, string]>([
    ["confirmed", "text-emerald-400"],
    ["pending", "text-amber-400"],
    ["confirming", "text-amber-400"],
    ["awaiting_signature", "text-amber-400"],
    ["reverted", "text-red-400"],
    ["rejected", "text-red-400"],
    ["error", "text-red-400"],
    ["idle", "text-gray-400"],
  ])("txStatusColor(%s) === %s", (status, expected) => {
    expect(txStatusColor(status)).toBe(expected);
  });
});

describe("seals getSealLineageCompleteness", () => {
  function detail(overrides: Partial<SealDetailRecord> = {}): SealDetailRecord {
    return {
      id: "seal-1",
      jobId: "job-1",
      status: "active",
      modelCommitment: "0xmodel",
      inputCommitment: "0xinput",
      outputCommitment: "0xoutput",
      requester: "aeth1req",
      validatorCount: 3,
      createdAt: "2026-07-01T00:00:00Z",
      expiresAt: null,
      validators: ["aeth1a", "aeth1b", "aeth1c"],
      revokedAt: null,
      revokedBy: "",
      revocationReason: "",
      job: { id: "job-1" } as SealDetailRecord["job"],
      proofLineage: {
        merkleRoot: "0xroot",
        teeMeasurement: "0xtee",
      } as SealDetailRecord["proofLineage"],
      detailAvailable: true,
      ...overrides,
    };
  }

  it("scores a fully-populated lineage at 100", () => {
    expect(getSealLineageCompleteness(detail())).toBe(100);
  });

  it("scores an empty lineage at 0", () => {
    expect(
      getSealLineageCompleteness(
        detail({
          modelCommitment: "",
          inputCommitment: "",
          outputCommitment: "",
          job: null,
          validators: [],
          proofLineage: null,
        }),
      ),
    ).toBe(0);
  });

  it.each([
    // 7 checkpoints: model, input, output, job.id, validators, merkleRoot, teeMeasurement
    [{ proofLineage: null }, 71], // 5 of 7
    [{ validators: [] }, 86], // 6 of 7
    [{ job: null }, 86], // 6 of 7
    [{ outputCommitment: "" }, 86], // 6 of 7
  ])("partial lineage %o -> %d%%", (overrides, expected) => {
    expect(getSealLineageCompleteness(detail(overrides))).toBe(expected);
  });

  it("treats an empty validators array as an incomplete checkpoint", () => {
    const withValidators = getSealLineageCompleteness(
      detail({ validators: ["x"] }),
    );
    const withoutValidators = getSealLineageCompleteness(
      detail({ validators: [] }),
    );
    expect(withValidators).toBeGreaterThan(withoutValidators);
  });

  it("counts only merkleRoot when teeMeasurement is missing", () => {
    const score = getSealLineageCompleteness(
      detail({
        proofLineage: {
          merkleRoot: "0xroot",
          teeMeasurement: "",
        } as SealDetailRecord["proofLineage"],
      }),
    );
    expect(score).toBe(86); // 6 of 7
  });
});
