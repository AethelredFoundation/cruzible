import { zeroAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertContractSimulation,
  getPreflightFailureMessage,
  getTransactionFailureMessage,
  isWalletRejectionError,
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

  it("reports decoded Cruzible custom errors instead of an unknown revert", async () => {
    const notify = vi.fn();
    simulateContractMock.mockRejectedValueOnce({
      shortMessage: "Execution reverted for an unknown reason.",
      cause: {
        data: {
          errorName: "TokenNotSet",
        },
      },
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
      "Contract simulation failed before wallet signing: The Cruzible vault has not been wired to its stAETHEL token deployment. (TokenNotSet)",
    );
  });

  it("identifies an undecodable revert as a likely stale vault deployment", async () => {
    const notify = vi.fn();
    simulateContractMock.mockRejectedValueOnce({
      shortMessage: "Execution reverted for an unknown reason.",
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
      "Contract simulation failed before wallet signing: The configured Cruzible vault rejected this call without a decodable error. Verify that NEXT_PUBLIC_CRUZIBLE_ADDRESS points to the replacement deployment for this release, then rebuild the frontend.",
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

  it("redacts provider URLs, credentials, and token-like values", () => {
    const message = getTransactionFailureMessage(
      new Error(
        "RPC failed at https://user:pass@rpc.example/path?access_token=super-secret with Authorization Bearer abc.def.ghi and signature=0xdeadbeef",
      ),
    );

    expect(message).toContain("https://rpc.example");
    expect(message).toContain("Bearer [REDACTED]");
    expect(message).toContain("signature=[REDACTED]");
    expect(message).not.toContain("user:pass");
    expect(message).not.toContain("access_token");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("abc.def.ghi");
    expect(message).not.toContain("0xdeadbeef");
  });

  it("classifies wallet rejections without treating arbitrary strings as trusted errors", () => {
    expect(
      isWalletRejectionError(
        Object.assign(new Error("User rejected the request"), { code: 4001 }),
      ),
    ).toBe(true);
    expect(isWalletRejectionError({ name: "UserRejectedRequestError" })).toBe(
      true,
    );
    expect(
      isWalletRejectionError({
        shortMessage: "The wallet says request denied by user",
      }),
    ).toBe(true);
    expect(isWalletRejectionError(new Error("RPC transport failed"))).toBe(
      false,
    );
    expect(
      isWalletRejectionError(new Error("RPC request denied by policy")),
    ).toBe(false);
    expect(isWalletRejectionError("rejected")).toBe(false);
  });
});
