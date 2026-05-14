import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionReceipt } from "viem";

const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000101";
const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
  waitState: {
    data: undefined as TransactionReceipt | undefined,
    error: null as Error | null,
    isFetching: false,
  },
  writeContractAsync: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useWaitForTransactionReceipt: mocks.useWaitForTransactionReceipt,
  useWriteContract: mocks.useWriteContract,
}));

import { useTransaction } from "@/hooks/useTransaction";

function receiptWithStatus(status: TransactionReceipt["status"]) {
  return {
    status,
    transactionHash: TX_HASH,
  } as unknown as TransactionReceipt;
}

describe("useTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitState = {
      data: undefined,
      error: null,
      isFetching: false,
    };
    mocks.useWriteContract.mockReturnValue({
      writeContractAsync: mocks.writeContractAsync,
    });
    mocks.useWaitForTransactionReceipt.mockImplementation(() => ({
      ...mocks.waitState,
    }));
    mocks.writeContractAsync.mockResolvedValue(TX_HASH);
  });

  it("waits for a submitted transaction receipt and marks it confirming", async () => {
    mocks.waitState.isFetching = true;
    const { result } = renderHook(() => useTransaction());

    await act(async () => {
      await result.current.send({
        address: CONTRACT_ADDRESS,
        abi: [],
        functionName: "stake",
        args: [1n],
      });
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe("confirming");
    });
    expect(result.current.state.hash).toBe(TX_HASH);
    expect(mocks.useWaitForTransactionReceipt).toHaveBeenLastCalledWith({
      hash: TX_HASH,
      confirmations: 1,
      query: { enabled: true },
    });
  });

  it("marks the transaction confirmed when the receipt succeeds", async () => {
    const { result, rerender } = renderHook(() => useTransaction());

    await act(async () => {
      await result.current.send({
        address: CONTRACT_ADDRESS,
        abi: [],
        functionName: "stake",
      });
    });

    mocks.waitState.data = receiptWithStatus("success");
    rerender();

    await waitFor(() => {
      expect(result.current.state.status).toBe("confirmed");
    });
    expect(result.current.state.receipt?.transactionHash).toBe(TX_HASH);
    expect(result.current.state.error).toBeNull();
  });

  it("marks the transaction reverted when the receipt reverts", async () => {
    const { result, rerender } = renderHook(() => useTransaction());

    await act(async () => {
      await result.current.send({
        address: CONTRACT_ADDRESS,
        abi: [],
        functionName: "unstake",
      });
    });

    mocks.waitState.data = receiptWithStatus("reverted");
    rerender();

    await waitFor(() => {
      expect(result.current.state.status).toBe("reverted");
    });
    expect(result.current.state.receipt?.status).toBe("reverted");
  });

  it("surfaces receipt wait errors", async () => {
    const waitError = new Error("receipt lookup failed");
    const { result, rerender } = renderHook(() => useTransaction());

    await act(async () => {
      await result.current.send({
        address: CONTRACT_ADDRESS,
        abi: [],
        functionName: "claimRewards",
      });
    });

    mocks.waitState.error = waitError;
    rerender();

    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });
    expect(result.current.state.error).toBe(waitError);
    expect(result.current.state.receipt).toBeNull();
  });

  it("keeps wallet rejections distinct from transport errors", async () => {
    mocks.writeContractAsync.mockRejectedValueOnce(
      Object.assign(new Error("User rejected the request"), { code: 4001 }),
    );
    const { result } = renderHook(() => useTransaction());

    await act(async () => {
      await result.current.send({
        address: CONTRACT_ADDRESS,
        abi: [],
        functionName: "stake",
      });
    });

    expect(result.current.state.status).toBe("rejected");
    expect(result.current.state.hash).toBeUndefined();
  });

  it("stores sanitized provider errors in transaction state", async () => {
    mocks.writeContractAsync.mockRejectedValueOnce(
      new Error(
        "RPC failed at https://user:pass@rpc.example/path?token=super-secret with signature=0xdeadbeef",
      ),
    );
    const { result } = renderHook(() => useTransaction());

    await act(async () => {
      await result.current.send({
        address: CONTRACT_ADDRESS,
        abi: [],
        functionName: "stake",
      });
    });

    expect(result.current.state.status).toBe("error");
    expect(result.current.state.error?.message).toContain(
      "https://rpc.example",
    );
    expect(result.current.state.error?.message).toContain(
      "signature=[REDACTED]",
    );
    expect(result.current.state.error?.message).not.toContain("user:pass");
    expect(result.current.state.error?.message).not.toContain("super-secret");
    expect(result.current.state.error?.message).not.toContain("0xdeadbeef");
  });
});
