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
