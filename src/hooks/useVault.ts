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
import { parseEther, formatEther, type Address, type Hash } from "viem";
import { CruzibleABI, ERC20ABI } from "@/config/abis";
import { CONTRACT_ADDRESSES } from "@/config/chains";
import { useApp } from "@/contexts/AppContext";

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

// ---------------------------------------------------------------------------
// Vault State Hook
// ---------------------------------------------------------------------------

export function useVaultState(): VaultState {
  const cruzibleAddr = CONTRACT_ADDRESSES.cruzible as Address;

  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "totalPooledAethel",
      },
      {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "totalShares",
      },
      {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "getExchangeRate",
      },
      {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "currentEpoch",
      },
      {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "effectiveAPY",
      },
    ],
    query: {
      enabled: !!cruzibleAddr,
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
  const cruzibleAddr = CONTRACT_ADDRESSES.cruzible as Address;

  const { data, isLoading, refetch } = useReadContract({
    address: cruzibleAddr,
    abi: CruzibleABI,
    functionName: "getUserWithdrawals",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!cruzibleAddr,
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
  const { addNotification } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();
  const cruzibleAddr = CONTRACT_ADDRESSES.cruzible as Address;
  const tokenAddr = CONTRACT_ADDRESSES.aethelToken as Address;

  const stake = useCallback(
    async (amountEther: string): Promise<Hash | undefined> => {
      if (!cruzibleAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Cruzible contract address not configured",
        );
        return undefined;
      }

      try {
        const amount = parseEther(amountEther);

        // Step 1: Approve AETHEL token spending
        if (tokenAddr) {
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
          });

          // Wait for approval to be mined before calling stake().
          // Without this, the stake tx may land before the approval is
          // confirmed on-chain, causing a revert.
          addNotification(
            "info",
            "Confirming Approval",
            "Waiting for approval to be confirmed on-chain...",
          );
          await waitForTransactionReceipt(config, { hash: approveHash });
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
    [writeContractAsync, config, cruzibleAddr, tokenAddr, addNotification],
  );

  return { stake, isPending };
}

// ---------------------------------------------------------------------------
// Unstake Hook
// ---------------------------------------------------------------------------

export function useUnstake() {
  const { addNotification } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();
  const cruzibleAddr = CONTRACT_ADDRESSES.cruzible as Address;

  const unstake = useCallback(
    async (sharesEther: string): Promise<Hash | undefined> => {
      if (!cruzibleAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Cruzible contract address not configured",
        );
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
    [writeContractAsync, config, cruzibleAddr, addNotification],
  );

  return { unstake, isPending };
}

// ---------------------------------------------------------------------------
// Withdraw Hook
// ---------------------------------------------------------------------------

export function useWithdraw() {
  const { addNotification } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();
  const cruzibleAddr = CONTRACT_ADDRESSES.cruzible as Address;

  const withdraw = useCallback(
    async (withdrawalId: bigint): Promise<Hash | undefined> => {
      if (!cruzibleAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Cruzible contract address not configured",
        );
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
    [writeContractAsync, config, cruzibleAddr, addNotification],
  );

  return { withdraw, isPending };
}

// ---------------------------------------------------------------------------
// Claim Rewards Hook
// ---------------------------------------------------------------------------

export function useClaimRewards() {
  const { addNotification } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useWriteContract();
  const cruzibleAddr = CONTRACT_ADDRESSES.cruzible as Address;

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
          "Cruzible contract address not configured",
        );
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
    [writeContractAsync, config, cruzibleAddr, addNotification],
  );

  return { claimRewards, isPending };
}
