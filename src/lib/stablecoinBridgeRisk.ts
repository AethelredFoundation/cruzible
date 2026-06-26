import { StablecoinPhase } from "@/lib/constants";

export type BridgeRiskTone = "healthy" | "warning" | "blocked";

export type BridgeRiskSignal = {
  id: string;
  title: string;
  status: string;
  detail: string;
  tone: BridgeRiskTone;
};

export type BridgeReadinessInput = {
  assetSymbol: string;
  assetPhase: StablecoinPhase | null;
  configLoading: boolean;
  configEnabled: boolean | null;
  mintPaused: boolean | null;
  dailyTxLimit: bigint | null;
  mintCeilingPerEpoch: bigint | null;
  walletConnected: boolean;
  wrongNetwork: boolean;
  allowanceLoading: boolean;
  approvalRequired: boolean;
  amountEntered: boolean;
  parsedAmount: bigint;
  destinationDomain: number;
};

export const STABLECOIN_BRIDGE_DISCLOSURES = [
  {
    title: "Settlement is asynchronous",
    body: "CCTP transfers depend on source-chain finality, Circle attestation, and destination-chain execution. Cruzible should not imply instant settlement.",
  },
  {
    title: "Fees are split across actors",
    body: "Wallet gas, token approval gas, bridge execution gas, and any external destination-chain costs are separate from the token amount being bridged.",
  },
  {
    title: "On-chain gates can stop flow",
    body: "Mint pauses, disabled assets, per-transaction limits, and per-epoch ceilings are live contract controls and can block an otherwise valid form.",
  },
  {
    title: "Destination-domain mistakes are costly",
    body: "Users must confirm the destination chain/domain before signing. Cruzible only offers configured domains, but wallet review is still required.",
  },
] as const;

export const STABLECOIN_BRIDGE_STEPS = [
  {
    title: "Approve",
    body: "The token approval is requested only when live allowance is below the bridge amount.",
  },
  {
    title: "Burn or lock",
    body: "The source-side bridge transaction executes against the configured stablecoin bridge contract.",
  },
  {
    title: "Attest",
    body: "CCTP settlement waits for finality and attestation before the destination side can complete.",
  },
  {
    title: "Receive",
    body: "Destination-chain receipt depends on the destination domain and external execution conditions.",
  },
] as const;

function phaseSignal(
  phase: StablecoinPhase | null,
  symbol: string,
): BridgeRiskSignal {
  if (phase === StablecoinPhase.ACTIVE) {
    return {
      id: "asset-phase",
      title: "Asset phase",
      status: `${symbol} active`,
      detail: "This asset is enabled in the checked-in stablecoin registry.",
      tone: "healthy",
    };
  }

  if (phase === StablecoinPhase.READ_ONLY) {
    return {
      id: "asset-phase",
      title: "Asset phase",
      status: `${symbol} read-only`,
      detail:
        "Balances and history may be visible, but bridge operations must remain disabled.",
      tone: "blocked",
    };
  }

  return {
    id: "asset-phase",
    title: "Asset phase",
    status: "Unavailable",
    detail:
      "This asset is not available for bridge operations in the current registry.",
    tone: "blocked",
  };
}

export function buildBridgeReadinessSignals(
  input: BridgeReadinessInput,
): BridgeRiskSignal[] {
  const onChainConfig: BridgeRiskSignal = input.configLoading
    ? {
        id: "on-chain-config",
        title: "On-chain config",
        status: "Verifying",
        detail:
          "Bridge actions stay disabled until live contract config is loaded.",
        tone: "warning",
      }
    : input.configEnabled === false
      ? {
          id: "on-chain-config",
          title: "On-chain config",
          status: "Disabled",
          detail: "The bridge contract reports this asset as disabled.",
          tone: "blocked",
        }
      : input.mintPaused
        ? {
            id: "on-chain-config",
            title: "On-chain config",
            status: "Mint paused",
            detail:
              "Minting is paused on-chain, so bridge-out operations must remain unavailable.",
            tone: "blocked",
          }
        : {
            id: "on-chain-config",
            title: "On-chain config",
            status: "Enabled",
            detail: "Live bridge config allows this asset right now.",
            tone: "healthy",
          };

  const walletSignal: BridgeRiskSignal = !input.walletConnected
    ? {
        id: "wallet",
        title: "Wallet",
        status: "Not connected",
        detail:
          "Connect a wallet before approvals, limits, and bridge execution can be evaluated.",
        tone: "warning",
      }
    : input.wrongNetwork
      ? {
          id: "wallet",
          title: "Wallet",
          status: "Wrong network",
          detail:
            "Switch to the configured active chain before signing bridge transactions.",
          tone: "blocked",
        }
      : {
          id: "wallet",
          title: "Wallet",
          status: "Ready",
          detail: "The connected wallet is on the expected chain.",
          tone: "healthy",
        };

  const approvalSignal: BridgeRiskSignal = input.allowanceLoading
    ? {
        id: "approval",
        title: "Approval",
        status: "Loading allowance",
        detail:
          "Allowance is read from chain before Cruzible decides whether approval is required.",
        tone: "warning",
      }
    : !input.amountEntered
      ? {
          id: "approval",
          title: "Approval",
          status: "Enter amount",
          detail:
            "Approval status is evaluated after a positive bridge amount is entered.",
          tone: "warning",
        }
      : input.approvalRequired
        ? {
            id: "approval",
            title: "Approval",
            status: "Required",
            detail:
              "A token approval transaction is required before bridge execution.",
            tone: "warning",
          }
        : {
            id: "approval",
            title: "Approval",
            status: "Covered",
            detail: "Current allowance covers the requested bridge amount.",
            tone: "healthy",
          };

  const limitsSignal: BridgeRiskSignal = input.configLoading
    ? {
        id: "bridge-limits",
        title: "Bridge limits",
        status: "Verifying",
        detail:
          "Daily transaction and epoch mint ceilings are loaded from the live bridge contract.",
        tone: "warning",
      }
    : input.amountEntered &&
        input.dailyTxLimit !== null &&
        input.dailyTxLimit > 0n &&
        input.parsedAmount > input.dailyTxLimit
      ? {
          id: "bridge-limits",
          title: "Bridge limits",
          status: "Daily limit exceeded",
          detail:
            "This amount is above the bridge contract's live daily transaction limit.",
          tone: "blocked",
        }
      : input.amountEntered &&
          input.mintCeilingPerEpoch !== null &&
          input.mintCeilingPerEpoch > 0n &&
          input.parsedAmount > input.mintCeilingPerEpoch
        ? {
            id: "bridge-limits",
            title: "Bridge limits",
            status: "Epoch ceiling exceeded",
            detail:
              "This amount is above the bridge contract's live mint ceiling for the current epoch.",
            tone: "blocked",
          }
        : input.dailyTxLimit === 0n && input.mintCeilingPerEpoch === 0n
          ? {
              id: "bridge-limits",
              title: "Bridge limits",
              status: "No explicit cap",
              detail:
                "The live contract did not report a daily or epoch ceiling, so operators should review this before production traffic.",
              tone: "warning",
            }
          : {
              id: "bridge-limits",
              title: "Bridge limits",
              status: input.amountEntered ? "Within limits" : "Configured",
              detail:
                "The live daily transaction and epoch mint ceiling checks are part of the pre-sign path.",
              tone: "healthy",
            };

  return [
    phaseSignal(input.assetPhase, input.assetSymbol),
    onChainConfig,
    walletSignal,
    approvalSignal,
    limitsSignal,
    {
      id: "destination-domain",
      title: "Destination domain",
      status: `Domain ${input.destinationDomain}`,
      detail:
        "Only configured CCTP domains are exposed in the destination selector.",
      tone: "healthy",
    },
    {
      id: "pre-sign-simulation",
      title: "Pre-sign simulation",
      status: "Enforced",
      detail:
        "Approval and bridge writes are simulated before the wallet opens.",
      tone: "healthy",
    },
  ];
}
