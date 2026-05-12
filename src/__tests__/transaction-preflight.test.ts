import { zeroAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertContractSimulation,
  getPreflightFailureMessage,
} from "@/lib/transactionPreflight";

const simulateContractMock = vi.fn();

vi.mock("wagmi/actions", () => ({
  simulateContract: (...args: unknown[]) => simulateContractMock(...args),
}));

const testAbi = [
  {
    name: "stake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

describe("transaction preflight", () => {
  beforeEach(() => {
    simulateContractMock.mockReset();
  });

  it("passes through successful simulations before wallet signing", async () => {
    const notify = vi.fn();
    simulateContractMock.mockResolvedValueOnce({ result: undefined });

    const ok = await assertContractSimulation({} as never, notify, "Stake", {
      address: zeroAddress,
      abi: testAbi,
      functionName: "stake",
      args: [1n],
      account: zeroAddress,
      chainId: 1,
    });

    expect(ok).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(simulateContractMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        address: zeroAddress,
        functionName: "stake",
        args: [1n],
        account: zeroAddress,
        chainId: 1,
      }),
    );
  });

  it("blocks wallet signing when simulation predicts a revert", async () => {
    const notify = vi.fn();
    simulateContractMock.mockRejectedValueOnce({
      shortMessage: "execution reverted: insufficient allowance",
    });

    const ok = await assertContractSimulation({} as never, notify, "Stake", {
      address: zeroAddress,
      abi: testAbi,
      functionName: "stake",
      args: [1n],
      account: zeroAddress,
      chainId: 1,
    });

    expect(ok).toBe(false);
    expect(notify).toHaveBeenCalledWith(
      "error",
      "Stake Blocked",
      "Contract simulation failed before wallet signing: execution reverted: insufficient allowance",
    );
  });

  it("normalizes and truncates noisy provider errors", () => {
    const noisy = new Error(`first line

      ${"x".repeat(400)}`);

    const message = getPreflightFailureMessage(noisy);

    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThanOrEqual(280);
    expect(message.endsWith("...")).toBe(true);
  });
});
