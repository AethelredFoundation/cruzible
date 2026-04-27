/**
 * useStablecoinBridge — Production hooks for stablecoin bridge interactions.
 *
 * Provides typed, error-handled hooks for:
 *   - Reading on-chain stablecoin configuration
 *   - Reading ERC-20 allowance for the bridge contract
 *   - Executing bridge-out via CCTP (approve → bridgeOutViaCCTP flow)
 *
 * Follows the same patterns as useVault.ts: writeContractAsync →
 * waitForTransactionReceipt → check receipt.status, with notifications
 * and proper error handling (code 4001 = user rejection).
 *
 * IMPORTANT: USDC/USDT use 6 decimals. All parseUnits/formatUnits calls
 * use asset.decimals from the registry, never parseEther (18 decimals).
 */

import { useCallback } from "react";
import {
  useReadContract,
  useWriteContract,
  useAccount,
  useConfig,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, pad, zeroAddress, type Hash } from "viem";
import { StablecoinBridgeABI, ERC20ABI } from "@/config/abis";
import {
  getContractAddress,
  getStablecoinTokenAddress,
  normalizeContractAddress,
} from "@/config/contracts";
import { activeChain } from "@/config/wagmi";
import { useApp } from "@/contexts/AppContext";
import {
  STABLECOIN_ASSETS,
  isStablecoinEnabled,
  type StablecoinAsset,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StablecoinOnChainConfig {
  enabled: boolean;
  mintPaused: boolean;
  routingType: number;
  token: string;
  mintCeilingPerEpoch: bigint;
  dailyTxLimit: bigint;
  hourlyOutflowBps: number;
  dailyOutflowBps: number;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Read Hooks
// ---------------------------------------------------------------------------

/**
 * Read the on-chain StablecoinConfig for a given symbol.
 * Uses the auto-generated `stablecoins(bytes32)` getter.
 */
export function useStablecoinConfig(symbol: string): StablecoinOnChainConfig {
  const asset = STABLECOIN_ASSETS[symbol];
  const bridgeAddr = getContractAddress("stablecoinBridge");

  const { data, isLoading } = useReadContract({
    address: bridgeAddr ?? zeroAddress,
    abi: StablecoinBridgeABI,
    functionName: "stablecoins",
    args: asset ? [asset.assetId] : undefined,
    query: {
      enabled: Boolean(asset && bridgeAddr),
      refetchInterval: 30_000,
    },
  });

  // The auto-generated getter returns a positional tuple matching
  // the StablecoinConfig struct in InstitutionalStablecoinBridge.sol:
  //   [0] enabled, [1] mintPaused, [2] routingType, [3] token,
  //   [4] tokenMessengerV2, [5] messageTransmitterV2, [6] proofOfReserveFeed,
  //   [7] mintCeilingPerEpoch, [8] dailyTxLimit,
  //   [9] hourlyOutflowBps, [10] dailyOutflowBps,
  //   [11] porDeviationBps, [12] porHeartbeatSeconds
  const result = data as
    | readonly [
        boolean,
        boolean,
        number,
        string,
        string,
        string,
        string,
        bigint,
        bigint,
        number,
        number,
        number,
        number,
      ]
    | undefined;

  return {
    enabled: result?.[0] ?? false,
    mintPaused: result?.[1] ?? false,
    routingType: result?.[2] ?? 0,
    token: result?.[3] ?? "",
    mintCeilingPerEpoch: result?.[7] ?? 0n,
    dailyTxLimit: result?.[8] ?? 0n,
    hourlyOutflowBps: result?.[9] ?? 0,
    dailyOutflowBps: result?.[10] ?? 0,
    isLoading,
  };
}

/**
 * Read the ERC-20 allowance the connected wallet has granted
 * to the stablecoin bridge contract for a given token.
 */
export function useStablecoinAllowance(symbol: string) {
  const { address } = useAccount();
  const bridgeAddr = getContractAddress("stablecoinBridge");
  const tokenAddr = getStablecoinTokenAddress(symbol);

  const { data, isLoading, refetch } = useReadContract({
    address: tokenAddr ?? zeroAddress,
    abi: ERC20ABI,
    functionName: "allowance",
    args: address && bridgeAddr ? [address, bridgeAddr] : undefined,
    query: {
      enabled: Boolean(address && tokenAddr && bridgeAddr),
      refetchInterval: 15_000,
    },
  });

  return {
    allowance: (data as bigint | undefined) ?? 0n,
    isLoading,
    refetch,
  };
}

// ---------------------------------------------------------------------------
// Write Hook — Bridge Out via CCTP
// ---------------------------------------------------------------------------

/**
 * Hook for executing a CCTP bridge-out operation.
 *
 * Flow: approve ERC-20 spending → bridgeOutViaCCTP
 *
 * Only works for assets with phase === ACTIVE. Calling with a
 * READ_ONLY or COMING_SOON asset will show an error notification
 * and return undefined.
 */
export function useBridgeOut() {
  const { addNotification, wallet } = useApp();
  const config = useConfig();
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const bridgeAddr = getContractAddress("stablecoinBridge");

  const bridgeOut = useCallback(
    async (
      symbol: string,
      amountHuman: string,
      destinationDomain: number,
      /** Live on-chain config — caller must pass this so we gate on real contract state */
      onChainConfig?: StablecoinOnChainConfig,
    ): Promise<Hash | undefined> => {
      // --- Validate ---
      const asset = STABLECOIN_ASSETS[symbol];
      if (!asset) {
        addNotification(
          "error",
          "Unknown Asset",
          `Stablecoin "${symbol}" is not registered.`,
        );
        return undefined;
      }

      if (!isStablecoinEnabled(asset)) {
        addNotification(
          "error",
          "Bridge Unavailable",
          `${symbol} is currently ${asset.phase === "READ_ONLY" ? "read-only" : "coming soon"}. Bridge operations are not available.`,
        );
        return undefined;
      }

      if (wallet.isWrongNetwork) {
        addNotification(
          "error",
          "Wrong Network",
          `Switch to ${activeChain.name} before submitting this transaction.`,
        );
        return undefined;
      }

      // Gate on live on-chain config — prevents submitting a tx that will revert
      if (onChainConfig && !onChainConfig.isLoading) {
        if (!onChainConfig.enabled) {
          addNotification(
            "error",
            "Bridge Disabled",
            `${symbol} bridging is currently disabled on-chain. Please try again later.`,
          );
          return undefined;
        }
        if (onChainConfig.mintPaused) {
          addNotification(
            "error",
            "Bridge Paused",
            `${symbol} minting is currently paused on-chain. Bridge-out operations are unavailable.`,
          );
          return undefined;
        }
      }

      if (!bridgeAddr) {
        addNotification(
          "error",
          "Configuration Error",
          "Stablecoin bridge contract address is not configured or invalid",
        );
        return undefined;
      }

      if (!address) {
        addNotification(
          "error",
          "Wallet Required",
          "Please connect your wallet to bridge stablecoins.",
        );
        return undefined;
      }

      const tokenAddr = getStablecoinTokenAddress(symbol);

      if (!tokenAddr) {
        addNotification(
          "error",
          "Configuration Error",
          `${symbol} token address is not configured or invalid`,
        );
        return undefined;
      }

      if (onChainConfig && !onChainConfig.isLoading && onChainConfig.enabled) {
        const onChainToken = normalizeContractAddress(onChainConfig.token);
        if (!onChainToken || onChainToken !== tokenAddr) {
          addNotification(
            "error",
            "Token Configuration Mismatch",
            `${symbol} token address does not match the bridge's on-chain configuration.`,
          );
          return undefined;
        }
      }

      try {
        // Parse amount using the asset's native decimals (6 for USDC/USDT)
        const amount = parseUnits(amountHuman, asset.decimals);

        // Step 1: Approve token spending
        addNotification(
          "info",
          "Approving",
          `Please approve ${symbol} spending in your wallet...`,
        );

        const approveHash = await writeContractAsync({
          address: tokenAddr,
          abi: ERC20ABI,
          functionName: "approve",
          args: [bridgeAddr, amount],
          chainId: activeChain.id,
        });

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
            `The ${symbol} approval was reverted on-chain.`,
          );
          return undefined;
        }

        // Step 2: Bridge out via CCTP
        // mintRecipient is the connected wallet address padded to bytes32
        const mintRecipient = pad(address, { size: 32 });

        addNotification(
          "info",
          "Bridging",
          `Please confirm the ${symbol} bridge-out transaction...`,
        );
        const hash = await writeContractAsync({
          address: bridgeAddr,
          abi: StablecoinBridgeABI,
          functionName: "bridgeOutViaCCTP",
          args: [asset.assetId, amount, destinationDomain, mintRecipient],
          chainId: activeChain.id,
        });

        addNotification(
          "info",
          "Bridge Submitted",
          `Transaction submitted. Waiting for confirmation... Hash: ${hash.slice(0, 10)}...`,
        );

        const receipt = await waitForTransactionReceipt(config, { hash });

        if (receipt.status === "reverted") {
          addNotification(
            "error",
            "Bridge Reverted",
            "The bridge transaction was reverted on-chain.",
          );
          return undefined;
        }

        addNotification(
          "success",
          "Bridge Confirmed",
          `${amountHuman} ${symbol} has been bridged out via CCTP. Funds will arrive on the destination chain shortly.`,
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
            "Bridge Failed",
            err?.shortMessage || err?.message || "Unknown error",
          );
        }
        return undefined;
      }
    },
    [writeContractAsync, config, bridgeAddr, address, wallet, addNotification],
  );

  return { bridgeOut, isPending };
}
