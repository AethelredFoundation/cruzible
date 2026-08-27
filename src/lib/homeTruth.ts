export interface HomeControlPlanePosture {
  hasWarning: boolean;
  warningMetric: string;
  body: string;
}

export const PUBLIC_QUERY_MAX_AGE_MS = 60_000;

export function isQuerySnapshotFresh(input: {
  hasData: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  now?: number;
  maxAgeMs?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? PUBLIC_QUERY_MAX_AGE_MS;
  return (
    input.hasData &&
    !input.isError &&
    Number.isFinite(input.dataUpdatedAt) &&
    input.dataUpdatedAt > 0 &&
    input.dataUpdatedAt <= now + 5_000 &&
    now - input.dataUpdatedAt <= maxAgeMs
  );
}

export function buildHomeControlPlanePosture(input: {
  isAvailable: boolean;
  isLoading: boolean;
  warningCount: number | null | undefined;
  epochSource: string | null | undefined;
}): HomeControlPlanePosture {
  if (!input.isAvailable) {
    return {
      hasWarning: true,
      warningMetric: "Unavailable",
      body: input.isLoading
        ? "Live public control-plane state is still loading. Cruzible will not report a healthy posture until the query succeeds."
        : "Live public control-plane state is unavailable. Cruzible is failing closed instead of reporting a healthy posture from missing data.",
    };
  }

  const warningCount = input.warningCount ?? 0;
  const hasWarning =
    warningCount > 0 || (input.epochSource ?? "").includes("fallback");

  return {
    hasWarning,
    warningMetric: String(warningCount),
    body: hasWarning
      ? "Some protocol telemetry is still on a warning path, so Cruzible is explicitly surfacing that state instead of pretending conditions are normal."
      : "Public control-plane state is available and the landing page is anchored to live reconciliation and validator data.",
  };
}

export function formatAvailableMetric(
  value: number | string,
  isAvailable: boolean,
): string {
  return isAvailable ? String(value) : "Unavailable";
}
