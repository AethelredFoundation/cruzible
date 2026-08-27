import { formatEther } from "viem";
import type { WithdrawalRequest } from "@/hooks/useVault";

export interface DisplayWithdrawalRequest {
  id: string;
  withdrawalId: bigint;
  amount: number;
  stAethelAmount: number;
  startDate: string;
  completionDate: string;
  status: "pending" | "ready" | "claimed";
  daysRemaining: number;
  totalDays: number;
}

export function formatUnbondingPeriod(seconds: bigint | null): string {
  if (seconds == null || seconds < 0n) return "Unavailable";
  if (seconds === 0n) return "No cooldown";

  const secondsPerDay = 86_400n;
  const secondsPerHour = 3_600n;
  const days = seconds / secondsPerDay;
  const hours = (seconds % secondsPerDay) / secondsPerHour;

  if (days > 0n) {
    const dayLabel = `${days.toString()} day${days === 1n ? "" : "s"}`;
    if (hours === 0n) return dayLabel;
    return `${dayLabel} ${hours.toString()} hour${hours === 1n ? "" : "s"}`;
  }

  const roundedHours = (seconds + secondsPerHour - 1n) / secondsPerHour;
  return `${roundedHours.toString()} hour${roundedHours === 1n ? "" : "s"}`;
}

export function calculateUnbondingCompletionTimeMs(
  seconds: bigint | null,
  nowMs: number,
): number | null {
  if (
    seconds == null ||
    seconds < 0n ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0
  ) {
    return null;
  }

  const maxAdditionalSeconds = BigInt(
    Math.floor((Number.MAX_SAFE_INTEGER - nowMs) / 1_000),
  );
  if (seconds > maxAdditionalSeconds) return null;

  const completion = nowMs + Number(seconds) * 1_000;
  return Number.isSafeInteger(completion) && completion <= 8.64e15
    ? completion
    : null;
}

export function toDisplayWithdrawalRequests(
  withdrawals: WithdrawalRequest[],
  nowSeconds: number,
): DisplayWithdrawalRequest[] {
  return withdrawals.map((withdrawal) => {
    const completion = Number(withdrawal.completionTime);
    const start = Number(withdrawal.requestTime);
    const totalSecs = completion - start;
    const daysRemaining = Math.max(
      0,
      Math.ceil((completion - nowSeconds) / 86400),
    );
    const totalDays = Math.ceil(totalSecs / 86400);

    return {
      id: `w${withdrawal.id.toString()}`,
      withdrawalId: withdrawal.id,
      amount: parseFloat(formatEther(withdrawal.aethelAmount)),
      // Withdrawal.shares is the invariant internal share unit. The rebasing
      // stAETHEL amount burned at request time is its AETHEL value, which the
      // vault snapshots in aethelAmount.
      stAethelAmount: parseFloat(formatEther(withdrawal.aethelAmount)),
      startDate: new Date(start * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      completionDate: new Date(completion * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      status: withdrawal.claimed
        ? "claimed"
        : daysRemaining === 0
          ? "ready"
          : "pending",
      daysRemaining,
      totalDays: Math.max(totalDays, 1),
    };
  });
}
