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
      stAethelAmount: parseFloat(formatEther(withdrawal.shares)),
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
