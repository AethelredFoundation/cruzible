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

const MAX_PROVIDER_ERROR_LENGTH = 280;
const PROVIDER_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/giu;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_-]*(?:api[-_]?key|auth|jwt|password|secret|signature|token)[A-Za-z0-9_-]*)(\s*[=:]\s*)([^\s,;]+)/giu;
const AUTH_HEADER_PATTERN = /\b(Bearer|Token)\s+[A-Za-z0-9._~+/-]+=*/giu;

function normalizeProviderMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function getProviderMessageCandidate(error: unknown): string | null {
  return typeof error === "object" && error !== null
    ? "shortMessage" in error && typeof error.shortMessage === "string"
      ? error.shortMessage
      : "message" in error && typeof error.message === "string"
        ? error.message
        : null
    : typeof error === "string"
      ? error
      : null;
}

function redactProviderUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "[REDACTED_URL]";
  }
}

function redactProviderMessage(message: string): string {
  return message
    .replace(PROVIDER_URL_PATTERN, (value) => redactProviderUrl(value))
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1$2[REDACTED]")
    .replace(AUTH_HEADER_PATTERN, "$1 [REDACTED]");
}

export function getTransactionFailureMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  const candidate = getProviderMessageCandidate(error);

  const normalized = candidate
    ? normalizeProviderMessage(redactProviderMessage(candidate))
    : fallback;

  return normalized.length > MAX_PROVIDER_ERROR_LENGTH
    ? `${normalized.slice(0, MAX_PROVIDER_ERROR_LENGTH - 3)}...`
    : normalized;
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
