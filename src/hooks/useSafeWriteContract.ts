"use client";

import { useCallback } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { bufferGasLimit } from "@/lib/gas";
import { activeChain, ACTIVE_GENESIS_HASH } from "@/config/chains";
import { assertWalletNetworkIdentity } from "@/lib/networkGenesis";
import { getPreflightFailureMessage } from "@/lib/transactionPreflight";

/**
 * Drop-in replacement for wagmi's `useWriteContract` that buffers the gas
 * limit before submitting.
 *
 * The Aethelred EVM's `eth_estimateGas` under-reports gas for
 * state-changing calls, so a raw wagmi write reverts out-of-gas. This
 * hook estimates the call, applies {@link bufferGasLimit}, and passes the
 * result as an explicit `gas` limit — unless the caller already set one.
 * Estimation failures fail closed before a wallet prompt because they usually
 * mean the transaction is known to revert in the current state.
 *
 * The parameter shape is intentionally permissive: wagmi's generic write
 * variables are a discriminated union that rejects a plain `{ value }` on
 * calls it can't prove are payable. This wrapper is a thin pass-through,
 * so it accepts the runtime shape and forwards to the (typed) wagmi hook.
 */
type WriteParams = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  gas?: bigint;
  chainId?: number;
  account?: `0x${string}`;
  [key: string]: unknown;
};

export function useSafeWriteContract() {
  const { writeContractAsync, ...rest } = useWriteContract();
  const publicClient = usePublicClient();
  // Tolerate a bare useAccount() mock: destructuring undefined would throw.
  const account = useAccount();
  const address = account?.address;

  type Runner = typeof writeContractAsync;
  const run = writeContractAsync as unknown as (
    p: WriteParams,
    o?: Parameters<Runner>[1],
  ) => ReturnType<Runner>;

  const safeWriteContractAsync = useCallback(
    async (params: WriteParams, options?: Parameters<Runner>[1]) => {
      // Preserve the caller's exact arity: only forward `options` when the
      // caller passed it, so `writeContractAsync(params)` stays a 1-arg call.
      const forward = (p: WriteParams) =>
        options === undefined ? run(p) : run(p, options);

      if (ACTIVE_GENESIS_HASH) {
        if (!publicClient || !account?.connector?.getProvider) {
          throw new Error(
            "Cannot verify the connected wallet network identity before signing.",
          );
        }
        const walletProvider = (await account.connector.getProvider()) as {
          request(args: {
            method: string;
            params?: readonly unknown[];
          }): Promise<unknown>;
        };
        await assertWalletNetworkIdentity({
          walletProvider,
          configuredProvider: publicClient,
          expectedChainId: params.chainId ?? activeChain.id,
          expectedGenesisHash: ACTIVE_GENESIS_HASH,
        });
      }

      if (params.gas === undefined && publicClient) {
        try {
          const estimate = await publicClient.estimateContractGas({
            address: params.address,
            abi: params.abi,
            functionName: params.functionName,
            args: params.args,
            value: params.value,
            account: params.account ?? address,
          } as Parameters<
            NonNullable<typeof publicClient>["estimateContractGas"]
          >[0]);
          return forward({ ...params, gas: bufferGasLimit(estimate) });
        } catch (error) {
          throw new Error(
            `Transaction blocked before wallet signing: ${getPreflightFailureMessage(error)}`,
          );
        }
      }
      return forward(params);
    },
    [run, publicClient, address, account?.connector],
  );

  return { ...rest, writeContractAsync: safeWriteContractAsync };
}
