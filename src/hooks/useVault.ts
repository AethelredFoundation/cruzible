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
  estimateGas,
  getBalance,
  getGasPrice,
  readContract,
  waitForTransactionReceipt,
} from "wagmi/actions";
import {
  parseEther,
  formatEther,
  encodeFunctionData,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { CruzibleABI, ERC20ABI, StAETHELABI } from "@/config/abis";
import { getContractAddress } from "@/config/contracts";
import { activeChain } from "@/config/wagmi";
import { useApp, type AppContextValue } from "@/contexts/AppContext";
import { bufferGasLimit } from "@/lib/gas";
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
  /** True only when every aggregate vault read completed successfully. */
  isAvailable: boolean;
  isError: boolean;
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
  expectedUnbondingPeriod?: bigint;
  expectedComplianceRequired?: boolean;
  expectedComplianceAdmitted?: boolean;
  complianceJobId?: string;
  maxMovementBps?: number;
}

const DEFAULT_VAULT_QUOTE_MAX_MOVEMENT_BPS = 50;
const BPS_DENOMINATOR = 10_000n;
const RATE_SCALE = parseEther("1");
export const FALLBACK_STAKE_GAS_RESERVE_WEI = parseEther("0.01");
const STAKE_GAS_PROBE_VALUE_WEI = parseEther("1");

export function calculateMaxNativeStakeAmount(
  balanceWei: bigint,
  gasReserveWei: bigint,
): bigint {
  return balanceWei > gasReserveWei ? balanceWei - gasReserveWei : 0n;
}

async function resolveStakeGasReserve(
  config: ReturnType<typeof useConfig>,
  cruzibleAddr: Address,
  account: Address,
  balanceWei: bigint,
  callData: Hex = toFunctionSelector("stake()"),
): Promise<bigint> {
  const fallback = FALLBACK_STAKE_GAS_RESERVE_WEI;
  const maxProbeValue = calculateMaxNativeStakeAmount(balanceWei, fallback);
  const probeValue =
    maxProbeValue > STAKE_GAS_PROBE_VALUE_WEI
      ? STAKE_GAS_PROBE_VALUE_WEI
      : maxProbeValue;

  if (probeValue <= 0n) {
    return fallback;
  }

  try {
    const [estimate, gasPrice] = await Promise.all([
      estimateGas(config, {
        account,
        chainId: activeChain.id,
        to: cruzibleAddr,
        value: probeValue,
        data: callData,
      }),
      getGasPrice(config, { chainId: activeChain.id }),
    ]);
    const estimatedReserve = bufferGasLimit(estimate) * gasPrice;

    return estimatedReserve > fallback ? estimatedReserve : fallback;
  } catch {
    // RPC estimation can fail when admission gates are closed. MAX must still
    // leave enough native AETHEL for gas instead of spending the full balance.
    return fallback;
  }
}

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
    maxMovementBps < 0 ||
    maxMovementBps > Number(BPS_DENOMINATOR)
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

function minimumAfterSlippage(quotedOutput: bigint, maxMovementBps: number) {
  if (
    !Number.isFinite(maxMovementBps) ||
    maxMovementBps < 0 ||
    maxMovementBps > Number(BPS_DENOMINATOR)
  ) {
    throw new Error("The quote slippage limit must be between 0 and 10000 bps");
  }

  return (
    (quotedOutput * (BPS_DENOMINATOR - BigInt(Math.floor(maxMovementBps)))) /
    BPS_DENOMINATOR
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

  const { data, dataUpdatedAt, isLoading, isError, isFetched } =
    useReadContracts({
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

  const isAvailable =
    Boolean(cruzibleAddr) &&
    isFetched &&
    !isError &&
    data?.length === 5 &&
    data.every(
      (read) => read.status === "success" && typeof read.result === "bigint",
    );

  return {
    totalPooledAethel: (data?.[0]?.result as bigint) ?? 0n,
    totalShares: (data?.[1]?.result as bigint) ?? 0n,
    exchangeRate: (data?.[2]?.result as bigint) ?? 0n,
    currentEpoch: (data?.[3]?.result as bigint) ?? 0n,
    effectiveAPY: (data?.[4]?.result as bigint) ?? 0n,
    quoteUpdatedAt: dataUpdatedAt,
    isLoading,
    isAvailable,
    isError: isError || (isFetched && !isAvailable),
  };
}

// ---------------------------------------------------------------------------
// User Withdrawals Hook
// ---------------------------------------------------------------------------

export function useUserWithdrawals() {
  const { address } = useAccount();
  const cruzibleAddr = getContractAddress("cruzible");

  const { data, isLoading, isError, error, isFetched, refetch } =
    useReadContract({
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
    isError,
    error,
    isFetched,
    refetch,
  };
}

export interface UnbondingPeriodState {
  seconds: bigint | null;
  isLoading: boolean;
  isError: boolean;
}

export function useUnbondingPeriod(): UnbondingPeriodState {
  const cruzibleAddr = getContractAddress("cruzible");
  const { data, isLoading, isError } = useReadContract({
    address: cruzibleAddr ?? zeroAddress,
    abi: CruzibleABI,
    functionName: "unbondingPeriod",
    chainId: activeChain.id,
    query: {
      enabled: Boolean(cruzibleAddr),
      refetchInterval: jitteredIntervalMs(30_000),
    },
  });
  const seconds = !isError && typeof data === "bigint" ? data : null;

  return { seconds, isLoading, isError };
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
  /** True only after both on-chain gate reads complete successfully. */
  isAvailable: boolean;
  /** Query-level or per-contract RPC failure. */
  isError: boolean;
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

  const { data, isLoading, isError } = useReadContracts({
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

  // useReadContracts defaults to allowFailure=true, so the query itself can
  // be "successful" while one contract result has status="failure". Treat
  // both per-call statuses as part of the admission decision; missing RPC
  // data must never be presented as an explicitly disabled identity gate.
  const readsAvailable =
    data?.[0]?.status === "success" && data?.[1]?.status === "success";
  const hasPerCallFailure =
    data?.[0]?.status === "failure" || data?.[1]?.status === "failure";
  const isAvailable = readsAvailable && !isError;
  const identityRequired = isAvailable && data?.[0]?.result === true;
  const isVerified =
    isAvailable && Boolean(address) && data?.[1]?.result === true;
  return {
    identityRequired,
    isVerified,
    blocksStaking:
      Boolean(address) && (!isAvailable || (identityRequired && !isVerified)),
    isAvailable,
    isError: isError || hasPerCallFailure,
    isLoading,
  };
}

const COMPLIANCE_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export function normalizeComplianceJobId(value: string): string | null {
  const normalized = value.trim();
  return COMPLIANCE_JOB_ID_PATTERN.test(normalized) ? normalized : null;
}

export interface ComplianceGateState {
  complianceRequired: boolean;
  isAdmitted: boolean;
  requiresSeal: boolean;
  blocksStaking: boolean;
  isAvailable: boolean;
  isError: boolean;
  isLoading: boolean;
}

/** Read Digital Seal admission without treating an RPC failure as gate-off. */
export function useComplianceGate(): ComplianceGateState {
  const { address } = useAccount();
  const cruzibleAddr = getContractAddress("cruzible");
  const { data, isLoading, isError } = useReadContracts({
    contracts: [
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "complianceRequired",
        chainId: activeChain.id,
      },
      {
        address: cruzibleAddr ?? zeroAddress,
        abi: CruzibleABI,
        functionName: "complianceAdmitted",
        args: [address ?? zeroAddress],
        chainId: activeChain.id,
      },
    ],
    query: {
      enabled: Boolean(cruzibleAddr),
      refetchInterval: jitteredIntervalMs(30_000),
    },
  });

  const readsAvailable =
    data?.[0]?.status === "success" && data?.[1]?.status === "success";
  const hasPerCallFailure =
    data?.[0]?.status === "failure" || data?.[1]?.status === "failure";
  const isAvailable = readsAvailable && !isError;
  const complianceRequired = isAvailable && data?.[0]?.result === true;
  const isAdmitted =
    isAvailable && Boolean(address) && data?.[1]?.result === true;
  const requiresSeal = complianceRequired && Boolean(address) && !isAdmitted;

  return {
    complianceRequired,
    isAdmitted,
    requiresSeal,
    blocksStaking: Boolean(address) && !isAvailable,
    isAvailable,
    isError: isError || hasPerCallFailure,
    isLoading,
  };
}

async function assertLiveStakeTerms(
  config: ReturnType<typeof useConfig>,
  cruzibleAddr: Address,
  account: Address,
  addNotification: AddNotification,
  quoteGuard?: VaultQuoteGuard,
): Promise<{
  unbondingPeriod: bigint;
  identityRequired: boolean;
  complianceRequired: boolean;
  complianceAdmitted: boolean;
  complianceJobId: string | null;
} | null> {
  try {
    const [
      unbondingPeriod,
      identityRequired,
      isIdentityVerified,
      complianceRequired,
      complianceAdmitted,
    ] = await Promise.all([
      readContract(config, {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "unbondingPeriod",
        chainId: activeChain.id,
      }),
      readContract(config, {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "identityRequired",
        chainId: activeChain.id,
      }),
      readContract(config, {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "isIdentityVerified",
        args: [account],
        chainId: activeChain.id,
      }),
      readContract(config, {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "complianceRequired",
        chainId: activeChain.id,
      }),
      readContract(config, {
        address: cruzibleAddr,
        abi: CruzibleABI,
        functionName: "complianceAdmitted",
        args: [account],
        chainId: activeChain.id,
      }),
    ]);

    if (typeof unbondingPeriod !== "bigint" || unbondingPeriod < 0n) {
      throw new Error("The vault returned an invalid unbonding period");
    }
    if (
      typeof identityRequired !== "boolean" ||
      typeof isIdentityVerified !== "boolean" ||
      typeof complianceRequired !== "boolean" ||
      typeof complianceAdmitted !== "boolean"
    ) {
      throw new Error("The vault returned an invalid admission-gate state");
    }

    if (
      quoteGuard?.expectedUnbondingPeriod !== undefined &&
      unbondingPeriod !== quoteGuard.expectedUnbondingPeriod
    ) {
      addNotification(
        "error",
        "Exit Terms Changed",
        "The vault withdrawal cooldown changed after the confirmation was shown. Review the live terms before signing.",
      );
      return null;
    }

    if (
      (quoteGuard?.expectedComplianceRequired !== undefined &&
        complianceRequired !== quoteGuard.expectedComplianceRequired) ||
      (quoteGuard?.expectedComplianceAdmitted !== undefined &&
        complianceAdmitted !== quoteGuard.expectedComplianceAdmitted)
    ) {
      addNotification(
        "error",
        "Admission Terms Changed",
        "The vault's Digital Seal admission state changed after confirmation was shown. Review the live compliance requirements before signing.",
      );
      return null;
    }

    if (identityRequired && !isIdentityVerified) {
      addNotification(
        "error",
        "ZeroID Identity Required",
        "This wallet no longer satisfies the vault's live ZeroID identity gate. Refresh your identity status before staking.",
      );
      return null;
    }

    const complianceJobId = normalizeComplianceJobId(
      quoteGuard?.complianceJobId ?? "",
    );
    if (complianceRequired && !complianceAdmitted && !complianceJobId) {
      addNotification(
        "error",
        "Digital Seal Job Required",
        "Enter the 1-64 character compliance job ID whose active Digital Seal is bound to this wallet.",
      );
      return null;
    }

    return {
      unbondingPeriod,
      identityRequired,
      complianceRequired,
      complianceAdmitted,
      complianceJobId,
    };
  } catch {
    addNotification(
      "error",
      "Stake Terms Unavailable",
      "Could not verify the live withdrawal cooldown, ZeroID identity, and Digital Seal admission state. Staking is blocked until every read succeeds.",
    );
    return null;
  }
}

async function assertLiveUnbondingPeriod(
  config: ReturnType<typeof useConfig>,
  cruzibleAddr: Address,
  addNotification: AddNotification,
  expectedUnbondingPeriod?: bigint,
): Promise<bigint | null> {
  try {
    const unbondingPeriod = await readContract(config, {
      address: cruzibleAddr,
      abi: CruzibleABI,
      functionName: "unbondingPeriod",
      chainId: activeChain.id,
    });
    if (typeof unbondingPeriod !== "bigint" || unbondingPeriod < 0n) {
      throw new Error("The vault returned an invalid unbonding period");
    }
    if (
      expectedUnbondingPeriod !== undefined &&
      unbondingPeriod !== expectedUnbondingPeriod
    ) {
      addNotification(
        "error",
        "Exit Terms Changed",
        "The vault withdrawal cooldown changed after the confirmation was shown. Review the live terms before signing.",
      );
      return null;
    }
    return unbondingPeriod;
  } catch {
    addNotification(
      "error",
      "Exit Terms Unavailable",
      "Could not verify the vault's live withdrawal cooldown. The unstake is blocked until this read succeeds.",
    );
    return null;
  }
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

  const getMaxStakeAmount = useCallback(
    async (options?: {
      requiresSeal?: boolean;
      complianceJobId?: string;
    }): Promise<bigint> => {
      if (!cruzibleAddr || !wallet.connected || !wallet.address) {
        return 0n;
      }

      const account = wallet.address as Address;
      const liveBalance = await getBalance(config, {
        address: account,
        chainId: activeChain.id,
      });
      const complianceJobId = normalizeComplianceJobId(
        options?.complianceJobId ?? "",
      );
      if (options?.requiresSeal && !complianceJobId) return 0n;
      const callData = options?.requiresSeal
        ? encodeFunctionData({
            abi: CruzibleABI,
            functionName: "stakeWithSealAndMinShares",
            args: [complianceJobId!, 0n],
          })
        : encodeFunctionData({
            abi: CruzibleABI,
            functionName: "stakeWithMinShares",
            args: [0n],
          });
      const reserve = await resolveStakeGasReserve(
        config,
        cruzibleAddr,
        account,
        liveBalance.value,
        callData,
      );

      return calculateMaxNativeStakeAmount(liveBalance.value, reserve);
    },
    [config, cruzibleAddr, wallet.address, wallet.connected],
  );

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

        const liveExchangeRate = await assertLiveExchangeRate(
          config,
          cruzibleAddr,
          addNotification,
          quoteGuard,
        );
        if (liveExchangeRate === null) {
          return undefined;
        }

        const quoteRate = quoteGuard?.expectedExchangeRate ?? liveExchangeRate;
        const quotedShares = (amount * RATE_SCALE) / quoteRate;
        const minShares = minimumAfterSlippage(
          quotedShares,
          quoteGuard?.maxMovementBps ?? DEFAULT_VAULT_QUOTE_MAX_MOVEMENT_BPS,
        );

        const stakeTerms = await assertLiveStakeTerms(
          config,
          cruzibleAddr,
          wallet.address as Address,
          addNotification,
          quoteGuard,
        );
        if (stakeTerms === null) {
          return undefined;
        }
        const requiresSeal =
          stakeTerms.complianceRequired && !stakeTerms.complianceAdmitted;
        const stakeFunctionName = requiresSeal
          ? "stakeWithSealAndMinShares"
          : "stakeWithMinShares";
        const stakeArgs = requiresSeal
          ? ([stakeTerms.complianceJobId!, minShares] as const)
          : ([minShares] as const);
        const stakeCallData = requiresSeal
          ? encodeFunctionData({
              abi: CruzibleABI,
              functionName: "stakeWithSealAndMinShares",
              args: [stakeTerms.complianceJobId!, minShares],
            })
          : encodeFunctionData({
              abi: CruzibleABI,
              functionName: "stakeWithMinShares",
              args: [minShares],
            });

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

        const gasReserve = await resolveStakeGasReserve(
          config,
          cruzibleAddr,
          wallet.address as Address,
          liveBalance.value,
          stakeCallData,
        );
        if (amount + gasReserve > liveBalance.value) {
          addNotification(
            "error",
            "Insufficient Gas Reserve",
            "Keep some AETHEL available for network gas. Use MAX to calculate the largest safe stake amount.",
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
            functionName: stakeFunctionName,
            args: stakeArgs,
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
          functionName: stakeFunctionName,
          args: stakeArgs,
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

  return {
    stake,
    getMaxStakeAmount,
    isPending: isPending || isSubmitting,
  };
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
      stAethelAmountEther: string,
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
        // stAETHEL is a rebasing ERC-20: balanceOf and the form input are
        // AETHEL-denominated token units, not the invariant raw-share unit
        // consumed by Cruzible.unstake*. Convert at the live rate immediately
        // before simulation/submission.
        const stAethelAmount = parseEther(stAethelAmountEther);

        if (stAethelAmount <= 0n) {
          addNotification(
            "error",
            "Invalid Amount",
            "Enter a stAETHEL amount greater than zero.",
          );
          return undefined;
        }

        const liveExchangeRate = await assertLiveExchangeRate(
          config,
          cruzibleAddr,
          addNotification,
          quoteGuard,
        );
        if (liveExchangeRate === null) {
          return undefined;
        }

        const minAethel = minimumAfterSlippage(
          stAethelAmount,
          quoteGuard?.maxMovementBps ?? DEFAULT_VAULT_QUOTE_MAX_MOVEMENT_BPS,
        );

        if (
          (await assertLiveUnbondingPeriod(
            config,
            cruzibleAddr,
            addNotification,
            quoteGuard?.expectedUnbondingPeriod,
          )) === null
        ) {
          return undefined;
        }

        const [convertedShares, liveShares, liveTokenBalance] =
          (await Promise.all([
            readContract(config, {
              address: stAethelAddr,
              abi: StAETHELABI,
              functionName: "getSharesByAethel",
              args: [stAethelAmount],
              chainId: activeChain.id,
            }),
            readContract(config, {
              address: stAethelAddr,
              abi: StAETHELABI,
              functionName: "sharesOf",
              args: [wallet.address as Address],
              chainId: activeChain.id,
            }),
            readContract(config, {
              address: stAethelAddr,
              abi: StAETHELABI,
              functionName: "balanceOf",
              args: [wallet.address as Address],
              chainId: activeChain.id,
            }),
          ])) as [bigint, bigint, bigint];

        const sharesToBurn =
          stAethelAmount === liveTokenBalance ? liveShares : convertedShares;

        if (stAethelAmount > liveTokenBalance || sharesToBurn > liveShares) {
          addNotification(
            "error",
            "Insufficient Balance",
            "Your live stAETHEL token balance is below this unstake amount. Refresh balances and try again.",
          );
          return undefined;
        }
        if (sharesToBurn <= 0n) {
          addNotification(
            "error",
            "Amount Too Small",
            "This stAETHEL amount rounds to zero raw shares at the live exchange rate.",
          );
          return undefined;
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
            functionName: "unstakeWithMinAethel",
            args: [sharesToBurn, minAethel],
            account: wallet.address as Address,
            chainId: activeChain.id,
          }))
        ) {
          return undefined;
        }

        const hash = await writeContractAsync({
          address: cruzibleAddr,
          abi: CruzibleABI,
          functionName: "unstakeWithMinAethel",
          args: [sharesToBurn, minAethel],
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
