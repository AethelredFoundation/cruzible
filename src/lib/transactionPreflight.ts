import type {
  Abi,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
} from "viem";
import type { Config } from "wagmi";
import {
  simulateContract,
  type SimulateContractParameters,
} from "wagmi/actions";
import { getPublicErrorMessage } from "@/lib/publicErrors";

export type TransactionPreflightNotification = (
  type: "error",
  title: string,
  message: string,
) => void;

const CONTRACT_REVERT_MESSAGES: Readonly<Record<string, string>> = {
  AccountCapExceeded:
    "This stake would exceed the vault's per-account testnet cap.",
  AlreadyClaimed: "This withdrawal or reward has already been claimed.",
  ComplianceGateClosed:
    "The vault's Digital Seal compliance gate rejected this stake.",
  DepositsArePaused: "New vault deposits are currently paused.",
  IdentityGateClosed: "The vault's ZeroID identity gate rejected this wallet.",
  InsufficientBuffer:
    "The vault does not have enough free buffer for this immediate exit.",
  InsufficientPool:
    "The vault does not have enough unreserved liquidity for this action.",
  MinimumAethelNotMet:
    "The live unstake output moved below the confirmed minimum.",
  MinimumSharesNotMet:
    "The live stake output moved below the confirmed minimum shares.",
  NotWithdrawalOwner: "The connected wallet does not own this withdrawal.",
  NotYetClaimable: "This withdrawal has not reached its claim time.",
  ProtocolInsolvent:
    "New deposits are blocked while the vault has an uncovered deficit.",
  Reentrancy: "The vault rejected a re-entrant transaction.",
  RewardsProofInvalid: "The supplied rewards proof is invalid.",
  RootNotSet: "The rewards root for this epoch has not been published.",
  SealAlreadyUsed: "This Digital Seal has already authorized a stake.",
  SealNotActive: "The supplied Digital Seal is not active.",
  SealNotBoundToStaker:
    "The supplied Digital Seal is not bound to the connected wallet.",
  SlippageExceeded:
    "The live output moved beyond the confirmed slippage limit.",
  StakeTooSmall: "The stake is too small to mint vault shares.",
  TokenNotSet:
    "The Cruzible vault has not been wired to its stAETHEL token deployment.",
  TvlCapExceeded: "This stake would exceed the vault's testnet TVL cap.",
  UnknownWithdrawal: "The requested withdrawal does not exist.",
  ZeroAmount: "The transaction amount must be greater than zero.",
};

function findContractRevertName(error: unknown): string | null {
  const visited = new Set<object>();
  let current = error;

  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if (visited.has(current)) return null;
    visited.add(current);

    const candidate = current as {
      cause?: unknown;
      data?: unknown;
      errorName?: unknown;
    };
    if (typeof candidate.errorName === "string") return candidate.errorName;

    if (typeof candidate.data === "object" && candidate.data !== null) {
      const decoded = candidate.data as { errorName?: unknown };
      if (typeof decoded.errorName === "string") return decoded.errorName;
    }

    current = candidate.cause;
  }

  return null;
}

export function getTransactionFailureMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  return getPublicErrorMessage(error, fallback);
}

export function getPreflightFailureMessage(error: unknown): string {
  const revertName = findContractRevertName(error);
  if (revertName && CONTRACT_REVERT_MESSAGES[revertName]) {
    return `${CONTRACT_REVERT_MESSAGES[revertName]} (${revertName})`;
  }

  return getTransactionFailureMessage(
    error,
    "The contract simulation failed before wallet signing.",
  );
}

export function isWalletRejectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    name?: unknown;
    shortMessage?: unknown;
    message?: unknown;
  };
  const message =
    typeof maybeError.shortMessage === "string"
      ? maybeError.shortMessage
      : typeof maybeError.message === "string"
        ? maybeError.message
        : "";
  const normalizedMessage = message.toLowerCase();

  return (
    maybeError.name === "UserRejectedRequestError" ||
    maybeError.code === 4001 ||
    normalizedMessage.includes("user rejected") ||
    normalizedMessage.includes("rejected the request") ||
    normalizedMessage.includes("transaction rejected") ||
    normalizedMessage.includes("denied by user") ||
    normalizedMessage.includes("user denied")
  );
}

export async function assertContractSimulation<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
  const args extends ContractFunctionArgs<
    abi,
    "nonpayable" | "payable",
    functionName
  >,
>(
  config: Config,
  addNotification: TransactionPreflightNotification,
  actionLabel: string,
  request: {
    address: Address;
    abi: abi;
    functionName: functionName;
    args: args;
    account: Address;
    chainId: number;
    // Native value for payable calls (e.g. Cruzible's payable stake()).
    // Threaded into simulateContract so the preview matches the real send.
    value?: bigint;
  },
): Promise<boolean> {
  try {
    await simulateContract(config, request as SimulateContractParameters);
    return true;
  } catch (error) {
    addNotification(
      "error",
      `${actionLabel} Blocked`,
      `Contract simulation failed before wallet signing: ${getPreflightFailureMessage(error)}`,
    );
    return false;
  }
}
