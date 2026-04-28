export function needsTokenApproval(
  allowance: bigint | undefined,
  requiredAmount: bigint,
): boolean {
  return (allowance ?? 0n) < requiredAmount;
}
