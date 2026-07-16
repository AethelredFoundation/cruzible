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

import { useCallback, useRef, useState } from "react";
import {
  useReadContract,
  useReadContracts,
  useAccount,
  useConfig,
} from "wagmi";
import { useSafeWriteContract } from "./useSafeWriteContract";
import {
  getBalance,
  readContract,
  waitForTransactionReceipt,
} from "wagmi/actions";
import {
  parseEther,
  formatEther,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { CruzibleABI, ERC20ABI, StAETHELABI } from "@/config/abis";
import { getContractAddress } from "@/config/contracts";
import { activeChain } from "@/config/wagmi";
import { useApp, type AppContextValue } from "@/contexts/AppContext";
import { needsTokenApproval } from "@/lib/allowance";
import {
  assertContractSimulation,
  getTransactionFailureMessage,
  isWalletRejectionError,
} from "@/lib/transactionPreflight";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultState {
  totalPooledAethel: bigint;
  totalShares: bigint;
  exchangeRate: bigint;
  currentEpoch: bigint;
  effectiveAPY: bigint;
  quoteUpdatedAt: number;
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

export interface VaultQuoteGuard {
  expectedExchangeRate: bigint;
  maxMovementBps?: number;
}

const DEFAULT_VAULT_QUOTE_MAX_MOVEMENT_BPS = 50;

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
  if (!wallet.connected || !wallet.address) {
    addNotification(
      "error",
      "Wallet Not Connected",
      "Connect a wallet before submitting this transaction.",
    );
    return false;
  }

  if (wallet.isWrongNetwork) {
    notifyWrongNetwork(addNotification);
    return false;
  }

  return true;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function hasMovedBeyondBps(
  liveExchangeRate: bigint,
  expectedExchangeRate: bigint,
  maxMovementBps: number,
): boolean {
  if (
    expectedExchangeRate <= 0n ||
    !Number.isFinite(maxMovementBps) ||
    maxMovementBps < 0
  ) {
    return true;
  }

  const delta =
    liveExchangeRate > expectedExchangeRate
      ? liveExchangeRate - expectedExchangeRate
      : expectedExchangeRate - liveExchangeRate;

  return (
    delta * 10_000n > expectedExchangeRate * BigInt(Math.floor(maxMovementBps))
  );
}

async function assertLiveExchangeRate(
  config: ReturnType<typeof useConfig>,
  cruzibleAddr: Address,
  addNotification: AddNotification,
  quoteGuard?: VaultQuoteGuard,
): Promise<bigint | null> {
  try {
    const exchangeRate = (await readContract(config, {
      address: cruzibleAddr,
      abi: CruzibleABI,
      functionName: "getExchangeRate",
      chainId: activeChain.id,
    })) as bigint;

    if (exchangeRate <= 0n) {
      addNotification(
        "error",
        "Quote Unavailable",
        "The vault returned an invalid exchange rate. Try again after the next contract read.",
      );
      return null;
    }

    if (
      quoteGuard &&
      hasMovedBeyondBps(
        exchangeRate,
        quoteGuard.expectedExchangeRate,
        quoteGuard.maxMovementBps ?? DEFAULT_VAULT_QUOTE_MAX_MOVEMENT_BPS,
      )
    ) {
      const maxMovementBps =
        quoteGuard.maxMovementBps ?? DEFAULT_VAULT_QUOTE_MAX_MOVEMENT_BPS;
      addNotification(
        "error",
        "Quote Moved",
        `The vault exchange rate moved more than ${formatBps(maxMovementBps)} from the displayed quote. Refresh the quote before signing.`,
      );
      return null;
    }

    return exchangeRate;
  } catch (err) {
    addNotification(
      "error",
      "Quote Check Failed",
      getTransactionFailureMessage(
        err,
        "Could not verify the live vault exchange rate before signing.",
      ),
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vault State Hook
// ---------------------------------------------------------------------------

/**
 * Per-mount jittered poll interval (base + 0..20%): many clients mounting
 * together must not synchronize into a "thundering herd" of identical
 * RPC bursts — each mount picks its own phase.
 */
function jitteredIntervalMs(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs * 0.2);
}

export function useVaultState(): VaultState {
  const cruzibleAddr = getContractAddress("cruzible");

  const { data, dataUpdatedAt, isLoading } = useReadContracts({
    contracts: [
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "totalPooledAethel",
        chainId: activeChain.id,
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "totalShares",
        chainId: activeChain.id,
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "getExchangeRate",
        chainId: activeChain.id,
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "currentEpoch",
        chainId: activeChain.id,
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "effectiveAPY",
        chainId: activeChain.id,
      },
    ],
    query: {
      enabled: Boolean(cruzibleAddr),
      refetchInterval: jitteredIntervalMs(15_000),
    },
  });

  return {
    totalPooledAethel: (data?.[0]?.result as bigint) ?? 0n,
    totalShares: (data?.[1]?.result as bigint) ?? 0n,
    exchangeRate: (data?.[2]?.result as bigint) ?? 0n,
    currentEpoch: (data?.[3]?.result as bigint) ?? 0n,
    effectiveAPY: (data?.[4]?.result as bigint) ?? 0n,
    quoteUpdatedAt: dataUpdatedAt,
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
    chainId: activeChain.id,
    query: {
      enabled: Boolean(address && cruzibleAddr),
      refetchInterval: jitteredIntervalMs(30_000),
    },
  });

  return {
    withdrawals: (data as WithdrawalRequest[] | undefined) ?? [],
    isLoading,
    refetch,
  };
}

// ---------------------------------------------------------------------------
// Identity Gate Hook (ZeroID — three-way integration)
// ---------------------------------------------------------------------------

export interface IdentityGateState {
  /** Whether the vault enforces the ZeroID identity gate. */
  identityRequired: boolean;
  /** Whether the CONNECTED wallet currently passes the gate. Only
   *  meaningful when identityRequired is true and a wallet is connected. */
  isVerified: boolean;
  /** identityRequired && wallet connected && not verified — the exact
   *  condition under which the vault would revert a stake. */
  blocksStaking: boolean;
  isLoading: boolean;
}

/**
 * Reads the vault's ZeroID identity gate: `identityRequired()` plus the
 * one-call `isIdentityVerified(staker)` surface. The check is LIVE on
 * chain (revocations in ZeroID reflect within a poll interval), so the UI
 * never caches an admission the contract would refuse.
 */
export function useIdentityGate(): IdentityGateState {
  const { address } = useAccount();
  const cruzibleAddr = getContractAddress("cruzible");

  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "identityRequired",
        chainId: activeChain.id,
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "isIdentityVerified",
        args: [address ?? zeroAddress],
        chainId: activeChain.id,
      },
    ],
    query: {
      enabled: Boolean(cruzibleAddr),
      refetchInterval: jitteredIntervalMs(30_000),
    },
  });

  const identityRequired = data?.[0]?.result === true;
  const isVerified = Boolean(address) && data?.[1]?.result === true;
  return {
    identityRequired,
    isVerified,
    blocksStaking: identityRequired && Boolean(address) && !isVerified,
    isLoading,
  };
}

// ---------------------------------------------------------------------------
// Stake Hook
// ---------------------------------------------------------------------------

export function useStake() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useSafeWriteContract();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const cruzibleAddr = getContractAddress("cruzible");

  const stake = useCallback(
    async (
      amountEther: string,
      quoteGuard?: VaultQuoteGuard,
    ): Promise<Hash | undefined> => {
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

      if (submitLockRef.current) {
        addNotification(
          "warning",
          "Transaction In Progress",
          "Wait for the current stake transaction to finish before submitting another.",
        );
        return undefined;
      }

      submitLockRef.current = true;
      setIsSubmitting(true);

      try {
        const amount = parseEther(amountEther);

        if (amount <= 0n) {
          addNotification(
            "error",
            "Invalid Amount",
            "Enter an AETHEL amount greater than zero.",
          );
          return undefined;
        }

        if (
          (await assertLiveExchangeRate(
            config,
            cruzibleAddr,
            addNotification,
            quoteGuard,
          )) === null
        ) {
          return undefined;
        }

        // AETHEL is the NATIVE coin on Aethelred — the deployed vault's
        // stake() is payable and takes the amount as msg.value. There is no
        // ERC-20 to balance-check, approve, or transferFrom; the previous
        // allowance dance here targeted a token model the shipped contract
        // never had, so staking failed before ever reaching the wallet.
        const liveBalance = await getBalance(config, {
          address: wallet.address as Address,
          chainId: activeChain.id,
        });

        if (amount > liveBalance.value) {
          addNotification(
            "error",
            "Insufficient Balance",
            "Your live AETHEL balance is below this stake amount. Refresh balances and try again.",
          );
          return undefined;
        }

        addNotification(
          "info",
          "Staking",
          "Please confirm the stake transaction...",
        );
        if (
          !(await assertContractSimulation(config, addNotification, "Stake", {
            address: cruzibleAddr,
            abi: CruzibleABI,
            functionName: "stake",
            args: [],
            value: amount,
            account: wallet.address as Address,
            chainId: activeChain.id,
          }))
        ) {
          return undefined;
        }

        const hash = await writeContractAsync({
          address: cruzibleAddr,
          abi: CruzibleABI,
          functionName: "stake",
          args: [],
          value: amount,
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
      } catch (err) {
        if (isWalletRejectionError(err)) {
          addNotification(
            "warning",
            "Rejected",
            "Transaction was rejected in wallet",
          );
        } else {
          addNotification(
            "error",
            "Stake Failed",
            getTransactionFailureMessage(err),
          );
        }
        return undefined;
      } finally {
        submitLockRef.current = false;
        setIsSubmitting(false);
      }
    },
    [writeContractAsync, config, cruzibleAddr, wallet, addNotification],
  );

  return { stake, isPending: isPending || isSubmitting };
}

// ---------------------------------------------------------------------------
// Unstake Hook
// ---------------------------------------------------------------------------

export function useUnstake() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useSafeWriteContract();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const cruzibleAddr = getContractAddress("cruzible");
  const stAethelAddr = getContractAddress("stAethel");

  const unstake = useCallback(
    async (
      sharesEther: string,
      quoteGuard?: VaultQuoteGuard,
    ): Promise<Hash | undefined> => {
      if (!cruzibleAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Cruzible contract address is not configured or invalid",
        );
        return undefined;
      }

      if (!stAethelAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "stAETHEL token address is not configured or invalid",
        );
        return undefined;
      }

      if (!canSubmitTransaction(wallet, addNotification)) {
        return undefined;
      }

      if (submitLockRef.current) {
        addNotification(
          "warning",
          "Transaction In Progress",
          "Wait for the current unstake transaction to finish before submitting another.",
        );
        return undefined;
      }

      submitLockRef.current = true;
      setIsSubmitting(true);

      try {
        const shares = parseEther(sharesEther);

        if (shares <= 0n) {
          addNotification(
            "error",
            "Invalid Amount",
            "Enter a stAETHEL amount greater than zero.",
          );
          return undefined;
        }

        if (
          (await assertLiveExchangeRate(
            config,
            cruzibleAddr,
            addNotification,
            quoteGuard,
          )) === null
        ) {
          return undefined;
        }

        const liveBalance = (await readContract(config, {
          address: stAethelAddr,
          abi: StAETHELABI,
          functionName: "balanceOf",
          args: [wallet.address as Address],
          chainId: activeChain.id,
        })) as bigint;

        if (shares > liveBalance) {
          addNotification(
            "error",
            "Insufficient Balance",
            "Your live stAETHEL token balance is below this unstake amount. Refresh balances and try again.",
          );
          return undefined;
        }

        addNotification(
          "info",
          "Checking Allowance",
          "Verifying the vault can burn the requested stAETHEL amount...",
        );

        const allowance = (await readContract(config, {
          address: stAethelAddr,
          abi: StAETHELABI,
          functionName: "allowance",
          args: [wallet.address as Address, cruzibleAddr],
          chainId: activeChain.id,
        })) as bigint;

        if (needsTokenApproval(allowance, shares)) {
          addNotification(
            "info",
            "Approving stAETHEL",
            "Please approve the vault to burn exactly this unstake amount...",
          );

          if (
            !(await assertContractSimulation(
              config,
              addNotification,
              "stAETHEL Approval",
              {
                address: stAethelAddr,
                abi: StAETHELABI,
                functionName: "approve",
                args: [cruzibleAddr, shares],
                account: wallet.address as Address,
                chainId: activeChain.id,
              },
            ))
          ) {
            return undefined;
          }

          const approveHash = await writeContractAsync({
            address: stAethelAddr,
            abi: StAETHELABI,
            functionName: "approve",
            args: [cruzibleAddr, shares],
            chainId: activeChain.id,
          });

          addNotification(
            "info",
            "Confirming Approval",
            "Waiting for stAETHEL approval to be confirmed on-chain...",
          );

          const approvalReceipt = await waitForTransactionReceipt(config, {
            hash: approveHash,
          });

          if (approvalReceipt.status === "reverted") {
            addNotification(
              "error",
              "Approval Reverted",
              "The stAETHEL approval was reverted on-chain.",
            );
            return undefined;
          }
        }

        addNotification(
          "info",
          "Unstaking",
          "Please confirm the unstake transaction...",
        );
        if (
          !(await assertContractSimulation(config, addNotification, "Unstake", {
            address: cruzibleAddr,
            abi: CruzibleABI,
            functionName: "unstake",
            args: [shares],
            account: wallet.address as Address,
            chainId: activeChain.id,
          }))
        ) {
          return undefined;
        }

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
      } catch (err) {
        if (isWalletRejectionError(err)) {
          addNotification(
            "warning",
            "Rejected",
            "Transaction was rejected in wallet",
          );
        } else {
          addNotification(
            "error",
            "Unstake Failed",
            getTransactionFailureMessage(err),
          );
        }
        return undefined;
      } finally {
        submitLockRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      writeContractAsync,
      config,
      cruzibleAddr,
      stAethelAddr,
      wallet,
      addNotification,
    ],
  );

  return { unstake, isPending: isPending || isSubmitting };
}

// ---------------------------------------------------------------------------
// Withdraw Hook
// ---------------------------------------------------------------------------

export function useWithdraw() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useSafeWriteContract();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
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

      if (submitLockRef.current) {
        addNotification(
          "warning",
          "Transaction In Progress",
          "Wait for the current withdrawal transaction to finish before submitting another.",
        );
        return undefined;
      }

      submitLockRef.current = true;
      setIsSubmitting(true);

      try {
        addNotification(
          "info",
          "Withdrawing",
          "Please confirm the withdrawal...",
        );
        if (
          !(await assertContractSimulation(
            config,
            addNotification,
            "Withdrawal",
            {
              address: cruzibleAddr,
              abi: CruzibleABI,
              functionName: "withdraw",
              args: [withdrawalId],
              account: wallet.address as Address,
              chainId: activeChain.id,
            },
          ))
        ) {
          return undefined;
        }

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
      } catch (err) {
        if (isWalletRejectionError(err)) {
          addNotification(
            "warning",
            "Rejected",
            "Transaction was rejected in wallet",
          );
        } else {
          addNotification(
            "error",
            "Withdrawal Failed",
            getTransactionFailureMessage(err),
          );
        }
        return undefined;
      } finally {
        submitLockRef.current = false;
        setIsSubmitting(false);
      }
    },
    [writeContractAsync, config, cruzibleAddr, wallet, addNotification],
  );

  return { withdraw, isPending: isPending || isSubmitting };
}

// ---------------------------------------------------------------------------
// Claim Rewards Hook
// ---------------------------------------------------------------------------

export function useClaimRewards() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { writeContractAsync, isPending } = useSafeWriteContract();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
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

      if (submitLockRef.current) {
        addNotification(
          "warning",
          "Transaction In Progress",
          "Wait for the current reward claim to finish before submitting another.",
        );
        return undefined;
      }

      submitLockRef.current = true;
      setIsSubmitting(true);

      try {
        addNotification(
          "info",
          "Claiming Rewards",
          "Please confirm the claim transaction...",
        );
        if (
          !(await assertContractSimulation(
            config,
            addNotification,
            "Reward Claim",
            {
              address: cruzibleAddr,
              abi: CruzibleABI,
              functionName: "claimRewards",
              args: [params.epoch, params.amount, params.proof],
              account: wallet.address as Address,
              chainId: activeChain.id,
            },
          ))
        ) {
          return undefined;
        }

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
      } catch (err) {
        if (isWalletRejectionError(err)) {
          addNotification(
            "warning",
            "Rejected",
            "Transaction was rejected in wallet",
          );
        } else {
          addNotification(
            "error",
            "Claim Failed",
            getTransactionFailureMessage(err),
          );
        }
        return undefined;
      } finally {
        submitLockRef.current = false;
        setIsSubmitting(false);
      }
    },
    [writeContractAsync, config, cruzibleAddr, wallet, addNotification],
  );

  return { claimRewards, isPending: isPending || isSubmitting };
}
