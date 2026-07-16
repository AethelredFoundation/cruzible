"use client";

import { useCallback } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { bufferGasLimit } from "@/lib/gas";

/**
 * Drop-in replacement for wagmi's `useWriteContract` that buffers the gas
 * limit before submitting.
 *
 * The Aethelred EVM's `eth_estimateGas` under-reports gas for
 * state-changing calls, so a raw wagmi write reverts out-of-gas. This
 * hook estimates the call, applies {@link bufferGasLimit}, and passes the
 * result as an explicit `gas` limit — unless the caller already set one.
 * If estimation itself reverts (a genuinely failing call), we fall
 * through to the normal write so wagmi surfaces the real revert reason
 * rather than masking it.
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
  const address = useAccount()?.address;

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
        } catch {
          // Estimation reverted — proceed with the plain write so wagmi/viem
          // reports the actual failure rather than us swallowing it.
        }
      }
      return forward(params);
    },
    [run, publicClient, address],
  );

  return { ...rest, writeContractAsync: safeWriteContractAsync };
}
