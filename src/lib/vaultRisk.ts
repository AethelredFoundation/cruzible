export type VaultRiskTone = "healthy" | "warning" | "blocked";

export type VaultRiskSignal = {
  id: string;
  title: string;
  status: string;
  detail: string;
  tone: VaultRiskTone;
};

export type VaultRiskInput = {
  hasAuthoritativeState: boolean;
  controlPlaneAvailable: boolean;
  controlPlaneWarningCount: number | null;
  epochSource: string | null;
  stakeSnapshotComplete: boolean | null;
};

export type WithdrawalLiquidityInput = {
  requestCount: number;
  pendingCount: number;
  readyCount: number;
  claimedCount: number;
  hasLiveExchangeRate: boolean;
};

export const VAULT_RISK_DISCLOSURES = [
  {
    title: "Validator and slashing risk",
    body: "Staking exposure depends on validator performance. Cruzible surfaces validator-universe and stake-snapshot evidence, but external review and staged slashing drills remain required before mainnet funds.",
  },
  {
    title: "Liquidity and exit timing",
    body: "Protocol withdrawals use a 21-day cooldown. Any secondary-market exit is separate from this vault flow and may carry price impact, counterparty risk, and unavailable liquidity.",
  },
  {
    title: "Exchange-rate movement",
    body: "Stake and unstake previews are blocked unless a fresh live exchange-rate quote is available. The signed transaction can still fail if the contract state moves beyond the displayed quote guard.",
  },
  {
    title: "Reward proof availability",
    body: "Claimable rewards are fetched from the proof pipeline at claim time. Cruzible does not invent balances when the proof endpoint is unavailable.",
  },
] as const;

export const WITHDRAWAL_LIQUIDITY_CHECKPOINTS = [
  {
    title: "Request",
    body: "Unstake burns or locks stAETHEL through the contract flow and creates a withdrawal request.",
  },
  {
    title: "Cooldown",
    body: "The request remains pending during the protocol cooldown; the UI shows only live on-chain requests.",
  },
  {
    title: "Claim",
    body: "AETHEL is claimable only when the contract marks the request ready.",
  },
  {
    title: "Secondary liquidity",
    body: "External liquidity venues are not treated as guaranteed exits inside the Cruzible vault.",
  },
] as const;

export function buildVaultRiskSignals(
  input: VaultRiskInput,
): VaultRiskSignal[] {
  const warningCount = input.controlPlaneWarningCount ?? 0;
  const usingFallbackEpoch = input.epochSource?.includes("fallback") ?? false;

  return [
    {
      id: "vault-telemetry",
      title: "Vault telemetry",
      status: input.hasAuthoritativeState ? "Live" : "Gated",
      detail: input.hasAuthoritativeState
        ? "TVL, APY, exchange rate, and epoch are sourced from live reads."
        : "Incomplete live reads are withheld instead of replaced with seeded numbers.",
      tone: input.hasAuthoritativeState ? "healthy" : "warning",
    },
    {
      id: "control-plane",
      title: "Control plane",
      status: !input.controlPlaneAvailable
        ? "Pending"
        : warningCount > 0
          ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
          : usingFallbackEpoch
            ? "Fallback epoch"
            : "No warnings",
      detail: !input.controlPlaneAvailable
        ? "Public reconciliation evidence is not reachable yet."
        : usingFallbackEpoch
          ? "The latest capture is using a fallback epoch source and should be reviewed."
          : "The latest public reconciliation capture is available for review.",
      tone:
        !input.controlPlaneAvailable || warningCount > 0 || usingFallbackEpoch
          ? "warning"
          : "healthy",
    },
    {
      id: "stake-snapshot",
      title: "Stake snapshot",
      status:
        input.stakeSnapshotComplete == null
          ? "Unavailable"
          : input.stakeSnapshotComplete
            ? "Complete"
            : "Partial",
      detail:
        input.stakeSnapshotComplete == null
          ? "Stake solvency coverage has not been published for this capture."
          : input.stakeSnapshotComplete
            ? "The public capture reports complete stake-snapshot coverage."
            : "Stake-snapshot coverage is incomplete, so solvency evidence is partial.",
      tone:
        input.stakeSnapshotComplete === true
          ? "healthy"
          : input.stakeSnapshotComplete === false
            ? "blocked"
            : "warning",
    },
    {
      id: "quote-guard",
      title: "Quote guard",
      status: "Enforced",
      detail:
        "Stake and unstake forms require a fresh live exchange-rate quote before signing.",
      tone: "healthy",
    },
    {
      id: "withdrawal-liquidity",
      title: "Withdrawal liquidity",
      status: "Cooldown enforced",
      detail:
        "The vault treats the 21-day protocol cooldown as the default exit path and does not promise instant liquidity.",
      tone: "warning",
    },
    {
      id: "reward-proof",
      title: "Reward proof",
      status: "On-demand",
      detail:
        "Reward claims fetch proof data at submission time instead of showing synthetic claimable balances.",
      tone: "healthy",
    },
  ];
}

export function buildWithdrawalLiquiditySummary(
  input: WithdrawalLiquidityInput,
): VaultRiskSignal[] {
  return [
    {
      id: "live-queue",
      title: "Live queue",
      status:
        input.requestCount === 0
          ? "No requests"
          : `${input.requestCount} request${input.requestCount === 1 ? "" : "s"}`,
      detail:
        input.requestCount === 0
          ? "No live withdrawal requests are visible for the connected wallet."
          : `${input.pendingCount} pending, ${input.readyCount} ready, ${input.claimedCount} claimed.`,
      tone: input.requestCount === 0 ? "warning" : "healthy",
    },
    {
      id: "quote-status",
      title: "Quote status",
      status: input.hasLiveExchangeRate ? "Live rate" : "Rate unavailable",
      detail: input.hasLiveExchangeRate
        ? "The unstake receive preview can be calculated from the live exchange rate."
        : "The unstake receive preview stays hidden until the live exchange rate is available.",
      tone: input.hasLiveExchangeRate ? "healthy" : "warning",
    },
    {
      id: "instant-exit",
      title: "Instant exit",
      status: "Not guaranteed",
      detail:
        "This vault flow does not advertise an emergency exit path unless the contract and liquidity venue support it.",
      tone: "blocked",
    },
  ];
}
