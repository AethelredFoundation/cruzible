/**
 * useVault — Production hooks for Cruzible vault interactions.
 *
 * Provides typed, error-handled hooks for:
 *   - Staking AETHEL → stAETHEL
 *   - Unstaking stAETHEL → withdrawal request
 *   - Claiming withdrawals
 *   - Reading vault state (TVL, exchange rate, APY, epoch)
 *   - Reading user withdrawals
 */

import { useCallback } from "react";
import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useConfig,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseEther, formatEther, zeroAddress, type Hash } from "viem";
import { CruzibleABI, ERC20ABI } from "@/config/abis";
import { getContractAddress } from "@/config/contracts";
import { activeChain } from "@/config/wagmi";
import { useApp, type AppContextValue } from "@/contexts/AppContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultState {
  totalPooledAethel: bigint;
  totalShares: bigint;
  exchangeRate: bigint;
  currentEpoch: bigint;
  effectiveAPY: bigint;
  isLoading: boolean;
}

export interface WithdrawalRequest {
  id: bigint;
  shares: bigint;
  aethelAmount: bigint;
  requestTime: bigint;
  completionTime: bigint;
  claimed: boolean;
}

type AddNotification = AppContextValue["addNotification"];
type WalletState = AppContextValue["wallet"];

function notifyWrongNetwork(addNotification: AddNotification): void {
  addNotification(
    "error",
    "Wrong Network",
    `Switch to ${activeChain.name} before submitting this transaction.`,
  );
}

function canSubmitTransaction(
  wallet: WalletState,
  addNotification: AddNotification,
): boolean {
  if (wallet.isWrongNetwork) {
    notifyWrongNetwork(addNotification);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Vault State Hook
// ---------------------------------------------------------------------------

export function useVaultState(): VaultState {
  const cruzibleAddr = getContractAddress("cruzible");

  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "totalPooledAethel",
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "totalShares",
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "getExchangeRate",
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "currentEpoch",
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "effectiveAPY",
      },
    ],
    query: {
      enabled: Boolean(cruzibleAddr),
      refetchInterval: 15_000,
    },
  });

  return {
    totalPooledAethel: (data?.[0]?.result as bigint) ?? 0n,
    totalShares: (data?.[1]?.result as bigint) ?? 0n,
    exchangeRate: (data?.[2]?.result as bigint) ?? 0n,
    currentEpoch: (data?.[3]?.result as bigint) ?? 0n,
    effectiveAPY: (data?.[4]?.result as bigint) ?? 0n,
    isLoading,
  };
}

// ---------------------------------------------------------------------------
// User Withdrawals Hook
// ---------------------------------------------------------------------------

export function useUserWithdrawals() {
  const { address } = useAccount();
  const cruzibleAddr = getContractAddress("cruzible");

  const { data, isLoading, refetch } = useReadContract({
    address: cruzibleAddr ?? zeroAddress,
    abi: CruzibleABI,
    functionName: "getUserWithdrawals",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address && cruzibleAddr),
      refetchInterval: 30_000,
    },
  });

  return {
    withdrawals: (data as WithdrawalRequest[] | undefined) ?? [],
    isLoading,
    refetch,
  };
}

// ---------------------------------------------------------------------------
// Stake Hook
// ---------------------------------------------------------------------------

export function useStake() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();
  const cruzibleAddr = getContractAddress("cruzible");
  const tokenAddr = getContractAddress("aethelToken");

  const stake = useCallback(
    async (amountEther: string): Promise<Hash | undefined> => {
      if (!cruzibleAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Cruzible contract address is not configured or invalid",
        );
        return undefined;
      }

      if (!tokenAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "AETHEL token address is not configured or invalid",
        );
        return undefined;
      }

      if (!canSubmitTransaction(wallet, addNotification)) {
        return undefined;
      }

      try {
        const amount = parseEther(amountEther);

        // Step 1: Approve AETHEL token spending
        addNotification(
          "info",
          "Approving",
          "Please approve AETHEL spending in your wallet...",
        );

        const approveHash = await writeContractAsync({
          address: tokenAddr,
          abi: ERC20ABI,
          functionName: "approve",
          args: [cruzibleAddr, amount],
          chainId: activeChain.id,
        });

        // Wait for approval to be mined before calling stake().
        // Without this, the stake tx may land before the approval is
        // confirmed on-chain, causing a revert.
        addNotification(
          "info",
          "Confirming Approval",
          "Waiting for approval to be confirmed on-chain...",
        );
        const approvalReceipt = await waitForTransactionReceipt(config, {
          hash: approveHash,
        });

        if (approvalReceipt.status === "reverted") {
          addNotification(
            "error",
            "Approval Reverted",
            "The AETHEL approval was reverted on-chain.",
          );
          return undefined;
        }

        // Step 2: Stake (only after approval receipt is confirmed)
        addNotification(
          "info",
          "Staking",
          "Please confirm the stake transaction...",
        );
        const hash = await writeContractAsync({
          address: cruzibleAddr,
          abi: CruzibleABI,
          functionName: "stake",
          args: [amount],
          chainId: activeChain.id,
        });

        // Submitted — but not yet confirmed on-chain.
        addNotification(
          "info",
          "Stake Submitted",
          `Transaction submitted. Waiting for confirmation... Hash: ${hash.slice(0, 10)}...`,
        );

        // Wait for the receipt before reporting final success.
        const receipt = await waitForTransactionReceipt(config, { hash });

        if (receipt.status === "reverted") {
          addNotification(
            "error",
            "Stake Reverted",
            "The stake transaction was reverted on-chain.",
          );
          return undefined;
        }

        addNotification(
          "success",
          "Stake Confirmed",
          "Your AETHEL has been staked and stAETHEL received.",
        );

        return hash;
      } catch (err: any) {
        const isRejection =
          err?.code === 4001 || err?.message?.includes("rejected");

        if (isRejection) {
          addNotification(
            "warning",
            "Rejected",
            "Transaction was rejected in wallet",
          );
        } else {
          addNotification(
            "error",
            "Stake Failed",
            err?.shortMessage || err?.message || "Unknown error",
          );
        }
        return undefined;
      }
    },
    [
      writeContractAsync,
      config,
      cruzibleAddr,
      tokenAddr,
      wallet,
      addNotification,
    ],
  );

  return { stake, isPending };
}

// ---------------------------------------------------------------------------
// Unstake Hook
// ---------------------------------------------------------------------------

export function useUnstake() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();
  const cruzibleAddr = getContractAddress("cruzible");

  const unstake = useCallback(
    async (sharesEther: string): Promise<Hash | undefined> => {
      if (!cruzibleAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Cruzible contract address is not configured or invalid",
        );
        return undefined;
      }

      if (!canSubmitTransaction(wallet, addNotification)) {
        return undefined;
      }

      try {
        const shares = parseEther(sharesEther);

        addNotification(
          "info",
          "Unstaking",
          "Please confirm the unstake transaction...",
        );
        const hash = await writeContractAsync({
          address: cruzibleAddr,
          abi: CruzibleABI,
          functionName: "unstake",
          args: [shares],
          chainId: activeChain.id,
        });

        // Submitted — but not yet confirmed on-chain.
        addNotification(
          "info",
          "Unstake Submitted",
          `Transaction submitted. Waiting for confirmation... Hash: ${hash.slice(0, 10)}...`,
        );

        // Wait for the receipt before reporting final success.
        const receipt = await waitForTransactionReceipt(config, { hash });

        if (receipt.status === "reverted") {
          addNotification(
            "error",
            "Unstake Reverted",
            "The unstake transaction was reverted on-chain.",
          );
          return undefined;
        }

        addNotification(
          "success",
          "Unstake Confirmed",
          "Withdrawal request created. Unbonding period starts now.",
        );

        return hash;
      } catch (err: any) {
        const isRejection =
          err?.code === 4001 || err?.message?.includes("rejected");

        if (isRejection) {
          addNotification(
            "warning",
            "Rejected",
            "Transaction was rejected in wallet",
          );
        } else {
          addNotification(
            "error",
            "Unstake Failed",
            err?.shortMessage || err?.message || "Unknown error",
          );
        }
        return undefined;
      }
    },
    [writeContractAsync, config, cruzibleAddr, wallet, addNotification],
  );

  return { unstake, isPending };
}

// ---------------------------------------------------------------------------
// Withdraw Hook
// ---------------------------------------------------------------------------

export function useWithdraw() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();
  const cruzibleAddr = getContractAddress("cruzible");

  const withdraw = useCallback(
    async (withdrawalId: bigint): Promise<Hash | undefined> => {
      if (!cruzibleAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Cruzible contract address is not configured or invalid",
        );
        return undefined;
      }

      if (!canSubmitTransaction(wallet, addNotification)) {
        return undefined;
      }

      try {
        addNotification(
          "info",
          "Withdrawing",
          "Please confirm the withdrawal...",
        );
        const hash = await writeContractAsync({
          address: cruzibleAddr,
          abi: CruzibleABI,
          functionName: "withdraw",
          args: [withdrawalId],
          chainId: activeChain.id,
        });

        // Submitted — but not yet confirmed on-chain.
        addNotification(
          "info",
          "Withdrawal Submitted",
          `Transaction submitted. Waiting for confirmation... Hash: ${hash.slice(0, 10)}...`,
        );

        // Wait for the receipt before reporting final success.
        const receipt = await waitForTransactionReceipt(config, { hash });

        if (receipt.status === "reverted") {
          addNotification(
            "error",
            "Withdrawal Reverted",
            "The withdrawal transaction was reverted on-chain.",
          );
          return undefined;
        }

        addNotification(
          "success",
          "Withdrawal Complete",
          "Your AETHEL has been returned to your wallet.",
        );

        return hash;
      } catch (err: any) {
        const isRejection =
          err?.code === 4001 || err?.message?.includes("rejected");

        if (isRejection) {
          addNotification(
            "warning",
            "Rejected",
            "Transaction was rejected in wallet",
          );
        } else {
          addNotification(
            "error",
            "Withdrawal Failed",
            err?.shortMessage || err?.message || "Unknown error",
          );
        }
        return undefined;
      }
    },
    [writeContractAsync, config, cruzibleAddr, wallet, addNotification],
  );

  return { withdraw, isPending };
}

// ---------------------------------------------------------------------------
// Claim Rewards Hook
// ---------------------------------------------------------------------------

export function useClaimRewards() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();
  const cruzibleAddr = getContractAddress("cruzible");

  const claimRewards = useCallback(
    async (params: {
      epoch: bigint;
      amount: bigint;
      proof: readonly `0x${string}`[];
    }): Promise<Hash | undefined> => {
      if (!cruzibleAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Cruzible contract address is not configured or invalid",
        );
        return undefined;
      }

      if (!canSubmitTransaction(wallet, addNotification)) {
        return undefined;
      }

      try {
        addNotification(
          "info",
          "Claiming Rewards",
          "Please confirm the claim transaction...",
        );
        const hash = await writeContractAsync({
          address: cruzibleAddr,
          abi: CruzibleABI,
          functionName: "claimRewards",
          args: [params.epoch, params.amount, params.proof],
          chainId: activeChain.id,
        });

        // Submitted — but not yet confirmed on-chain.
        addNotification(
          "info",
          "Claim Submitted",
          `Transaction submitted. Waiting for confirmation... Hash: ${hash.slice(0, 10)}...`,
        );

        // Wait for the receipt before reporting final success.
        const receipt = await waitForTransactionReceipt(config, { hash });

        if (receipt.status === "reverted") {
          addNotification(
            "error",
            "Claim Reverted",
            "The claim transaction was reverted on-chain.",
          );
          return undefined;
        }

        addNotification(
          "success",
          "Rewards Claimed",
          "Your rewards have been sent to your wallet.",
        );

        return hash;
      } catch (err: any) {
        const isRejection =
          err?.code === 4001 || err?.message?.includes("rejected");

        if (isRejection) {
          addNotification(
            "warning",
            "Rejected",
            "Transaction was rejected in wallet",
          );
        } else {
          addNotification(
            "error",
            "Claim Failed",
            err?.shortMessage || err?.message || "Unknown error",
          );
        }
        return undefined;
      }
    },
    [writeContractAsync, config, cruzibleAddr, wallet, addNotification],
  );

  return { claimRewards, isPending };
}
