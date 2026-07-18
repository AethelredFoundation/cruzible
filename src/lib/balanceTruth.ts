import { isQuerySnapshotFresh } from "@/lib/homeTruth";

export type BalanceReadStatus =
  | "available"
  | "loading"
  | "stale"
  | "unavailable";

export function classifyBalanceRead(input: {
  hasValue: boolean;
  isLoading: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  now?: number;
}): BalanceReadStatus {
  if (
    isQuerySnapshotFresh({
      hasData: input.hasValue,
      isError: input.isError,
      dataUpdatedAt: input.dataUpdatedAt,
      now: input.now,
    })
  ) {
    return "available";
  }
  if (input.hasValue) return "stale";
  if (input.isLoading) return "loading";
  return "unavailable";
}
