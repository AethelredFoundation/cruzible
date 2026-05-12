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

export type TransactionPreflightNotification = (
  type: "error",
  title: string,
  message: string,
) => void;

const MAX_PREFLIGHT_ERROR_LENGTH = 280;

function normalizeProviderMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

export function getPreflightFailureMessage(error: unknown): string {
  const candidate =
    typeof error === "object" && error !== null
      ? "shortMessage" in error && typeof error.shortMessage === "string"
        ? error.shortMessage
        : "message" in error && typeof error.message === "string"
          ? error.message
          : null
      : typeof error === "string"
        ? error
        : null;

  const normalized = candidate
    ? normalizeProviderMessage(candidate)
    : "The contract simulation failed before wallet signing.";

  return normalized.length > MAX_PREFLIGHT_ERROR_LENGTH
    ? `${normalized.slice(0, MAX_PREFLIGHT_ERROR_LENGTH - 3)}...`
    : normalized;
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
