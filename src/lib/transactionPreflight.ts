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

export function getTransactionFailureMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  return getPublicErrorMessage(error, fallback);
}

export function getPreflightFailureMessage(error: unknown): string {
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
