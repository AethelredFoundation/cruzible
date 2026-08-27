import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  estimateContractGas: vi.fn(),
  writeContractAsync: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
  }),
  usePublicClient: () => ({
    estimateContractGas: mocks.estimateContractGas,
  }),
  useWriteContract: () => ({
    writeContractAsync: mocks.writeContractAsync,
    isPending: false,
  }),
}));

vi.mock("@/config/chains", () => ({
  activeChain: { id: 7332 },
  ACTIVE_GENESIS_HASH: undefined,
}));

import { useSafeWriteContract } from "@/hooks/useSafeWriteContract";

describe("useSafeWriteContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not open the wallet when gas estimation says the call will revert", async () => {
    mocks.estimateContractGas.mockRejectedValueOnce(
      new Error("execution reverted: vault paused"),
    );
    const { result } = renderHook(() => useSafeWriteContract());

    await expect(
      act(() =>
        result.current.writeContractAsync({
          address: "0x2222222222222222222222222222222222222222",
          abi: [],
          functionName: "stake",
          value: 1n,
          chainId: 7332,
        }),
      ),
    ).rejects.toThrow("blocked before wallet signing");
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
  });

  it("buffers a successful estimate before forwarding the write", async () => {
    mocks.estimateContractGas.mockResolvedValueOnce(100_000n);
    mocks.writeContractAsync.mockResolvedValueOnce(`0x${"a".repeat(64)}`);
    const { result } = renderHook(() => useSafeWriteContract());

    await act(() =>
      result.current.writeContractAsync({
        address: "0x2222222222222222222222222222222222222222",
        abi: [],
        functionName: "stake",
        value: 1n,
        chainId: 7332,
      }),
    );

    expect(mocks.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 800_000n }),
    );
  });
});
