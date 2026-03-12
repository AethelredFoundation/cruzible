/**
 * useTransaction — Transaction lifecycle management hook
 *
 * Provides a consistent UX for sending blockchain transactions:
 * pending → confirming → confirmed / reverted / dropped
 *
 * Integrates with the AppContext notification system for toast feedback.
 */

import { useCallback, useState } from 'react';
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  type UseWriteContractParameters,
} from 'wagmi';
import { type Abi, type Address, type Hash } from 'viem';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxStatus =
  | 'idle'
  | 'awaiting_signature' // Wallet popup is open
  | 'pending'            // Tx submitted, waiting for confirmation
  | 'confirming'         // Tx included in block, waiting for finality
  | 'confirmed'          // Tx finalized
  | 'reverted'           // Tx included but reverted
  | 'rejected'           // User rejected in wallet
  | 'error';             // Other error (RPC timeout, dropped, etc.)

export interface TxState {
  status: TxStatus;
  hash: Hash | undefined;
  error: Error | null;
  receipt: ReturnType<typeof useWaitForTransactionReceipt>['data'] | null;
}

export interface UseTransactionReturn {
  state: TxState;
  send: (params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  }) => Promise<Hash | undefined>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTransaction(): UseTransactionReturn {
  const [state, setState] = useState<TxState>({
    status: 'idle',
    hash: undefined,
    error: null,
    receipt: null,
  });

  const { writeContractAsync } = useWriteContract();

  const send = useCallback(
    async (params: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
    }): Promise<Hash | undefined> => {
      setState({
        status: 'awaiting_signature',
        hash: undefined,
        error: null,
        receipt: null,
      });

      try {
        const hash = await writeContractAsync({
          address: params.address,
          abi: params.abi as any,
          functionName: params.functionName,
          args: params.args as any,
          value: params.value,
        });

        setState((prev) => ({
          ...prev,
          status: 'pending',
          hash,
        }));

        return hash;
      } catch (err: any) {
        // Detect user rejection
        const isRejection =
          err?.name === 'UserRejectedRequestError' ||
          err?.code === 4001 ||
          err?.message?.includes('rejected') ||
          err?.message?.includes('denied');

        setState({
          status: isRejection ? 'rejected' : 'error',
          hash: undefined,
          error: err instanceof Error ? err : new Error(String(err)),
          receipt: null,
        });

        return undefined;
      }
    },
    [writeContractAsync],
  );

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      hash: undefined,
      error: null,
      receipt: null,
    });
  }, []);

  return { state, send, reset };
}

// ---------------------------------------------------------------------------
// Status display helpers
// ---------------------------------------------------------------------------

export function txStatusLabel(status: TxStatus): string {
  switch (status) {
    case 'idle':
      return '';
    case 'awaiting_signature':
      return 'Awaiting wallet signature...';
    case 'pending':
      return 'Transaction submitted, waiting for confirmation...';
    case 'confirming':
      return 'Transaction included, confirming...';
    case 'confirmed':
      return 'Transaction confirmed!';
    case 'reverted':
      return 'Transaction reverted';
    case 'rejected':
      return 'Transaction rejected in wallet';
    case 'error':
      return 'Transaction failed';
    default:
      return '';
  }
}

export function txStatusColor(status: TxStatus): string {
  switch (status) {
    case 'confirmed':
      return 'text-emerald-400';
    case 'pending':
    case 'confirming':
    case 'awaiting_signature':
      return 'text-amber-400';
    case 'reverted':
    case 'rejected':
    case 'error':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}
