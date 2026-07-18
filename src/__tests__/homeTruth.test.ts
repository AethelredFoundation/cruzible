import { describe, expect, it } from "vitest";
import {
  buildHomeControlPlanePosture,
  formatAvailableMetric,
  isQuerySnapshotFresh,
} from "@/lib/homeTruth";

describe("home truth presentation", () => {
  it("never reports success or zero warnings when control-plane data is absent", () => {
    const posture = buildHomeControlPlanePosture({
      isAvailable: false,
      isLoading: false,
      warningCount: undefined,
      epochSource: undefined,
    });

    expect(posture.hasWarning).toBe(true);
    expect(posture.warningMetric).toBe("Unavailable");
    expect(posture.body).toContain("failing closed");
  });

  it("distinguishes a loaded zero from an unavailable metric", () => {
    expect(formatAvailableMetric(0, true)).toBe("0");
    expect(formatAvailableMetric(0, false)).toBe("Unavailable");
  });

  it("reports success only from an available clean snapshot", () => {
    const posture = buildHomeControlPlanePosture({
      isAvailable: true,
      isLoading: false,
      warningCount: 0,
      epochSource: "chain",
    });

    expect(posture.hasWarning).toBe(false);
    expect(posture.warningMetric).toBe("0");
  });

  it("rejects cached data after a refetch error", () => {
    expect(
      isQuerySnapshotFresh({
        hasData: true,
        isError: true,
        dataUpdatedAt: Date.parse("2026-07-18T12:00:00.000Z"),
        now: Date.parse("2026-07-18T12:00:10.000Z"),
      }),
    ).toBe(false);
  });

  it("rejects an old snapshot even when cached data is retained", () => {
    expect(
      isQuerySnapshotFresh({
        hasData: true,
        isError: false,
        dataUpdatedAt: Date.parse("2026-07-18T12:00:00.000Z"),
        now: Date.parse("2026-07-18T12:02:00.000Z"),
      }),
    ).toBe(false);
  });

  it("accepts a recent successful snapshot", () => {
    expect(
      isQuerySnapshotFresh({
        hasData: true,
        isError: false,
        dataUpdatedAt: Date.parse("2026-07-18T12:00:00.000Z"),
        now: Date.parse("2026-07-18T12:00:30.000Z"),
      }),
    ).toBe(true);
  });
});
