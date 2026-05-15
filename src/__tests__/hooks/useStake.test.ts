import { act, renderHook } from "@testing-library/react";
import { parseEther } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CRUZIBLE_ADDRESS = "0x0000000000000000000000000000000000000101";
const AETHEL_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000202";
const ST_AETHEL_ADDRESS = "0x0000000000000000000000000000000000000404";
const WALLET_ADDRESS = "0x0000000000000000000000000000000000000303";
const APPROVAL_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STAKE_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const UNSTAKE_HASH =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const WITHDRAW_HASH =
  "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const CLAIM_HASH =
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const mockConfig = { uid: "wagmi-config" };

const mocks = vi.hoisted(() => ({
  addNotification: vi.fn(),
  assertContractSimulation: vi.fn(),
  readContract: vi.fn(),
  useApp: vi.fn(),
  useConfig: vi.fn(),
  useWriteContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
}));

vi.mock("@/config/abis", () => ({
  CruzibleABI: [],
  ERC20ABI: [],
  StAETHELABI: [],
}));

vi.mock("@/config/contracts", () => ({
  getContractAddress: (key: string) => {
    const addresses: Record<string, string> = {
      cruzible: CRUZIBLE_ADDRESS,
      aethelToken: AETHEL_TOKEN_ADDRESS,
      stAethel: ST_AETHEL_ADDRESS,
    };

    return addresses[key];
  },
}));

vi.mock("@/config/wagmi", () => ({
  activeChain: { id: 4242, name: "Aethelred Testnet" },
}));

vi.mock("@/contexts/AppContext", () => ({
  useApp: mocks.useApp,
}));

vi.mock("@/lib/transactionPreflight", () => ({
  assertContractSimulation: mocks.assertContractSimulation,
  getTransactionFailureMessage: (error: unknown, fallback = "Unknown error") =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
  useConfig: mocks.useConfig,
  useReadContract: vi.fn(),
  useReadContracts: vi.fn(),
  useWriteContract: mocks.useWriteContract,
}));

vi.mock("wagmi/actions", () => ({
  readContract: mocks.readContract,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

import {
  useClaimRewards,
  useStake,
  useUnstake,
  useWithdraw,
} from "@/hooks/useVault";

function setConnectedWallet() {
  mocks.useApp.mockReturnValue({
    addNotification: mocks.addNotification,
    wallet: {
      connected: true,
      address: WALLET_ADDRESS,
      balance: 0,
      balanceWei: 0n,
      aethelBalance: 0,
      aethelBalanceWei: 0n,
      stBalance: 0,
      stBalanceWei: 0n,
      stablecoinBalances: {},
      stablecoinBalanceUnits: {},
      isConnecting: false,
      isWrongNetwork: false,
      chainId: 4242,
    },
  });
}

describe("useStake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectedWallet();
    mocks.useConfig.mockReturnValue(mockConfig);
    mocks.useWriteContract.mockReturnValue({
      isPending: false,
      writeContractAsync: mocks.writeContractAsync,
    });
    mocks.assertContractSimulation.mockResolvedValue(true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("skips approval when the existing allowance covers the requested stake", async () => {
    const amount = parseEther("1");
    mocks.readContract
      .mockResolvedValueOnce(parseEther("1"))
      .mockResolvedValueOnce(amount)
      .mockResolvedValueOnce(amount);
    mocks.writeContractAsync.mockResolvedValueOnce(STAKE_HASH);

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("1");
    });

    expect(hash).toBe(STAKE_HASH);
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: CRUZIBLE_ADDRESS,
      abi: [],
      functionName: "stake",
      args: [amount],
      chainId: 4242,
    });
    expect(mocks.assertContractSimulation).toHaveBeenCalledTimes(1);
    expect(mocks.assertContractSimulation).toHaveBeenCalledWith(
      mockConfig,
      mocks.addNotification,
      "Stake",
      expect.objectContaining({
        address: CRUZIBLE_ADDRESS,
        functionName: "stake",
        args: [amount],
      }),
    );
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mockConfig, {
      hash: STAKE_HASH,
    });
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "info",
      "Allowance Ready",
      "Existing AETHEL allowance covers this stake.",
    );
  });

  it("approves the exact stake amount before staking when allowance is missing", async () => {
    const amount = parseEther("2.5");
    mocks.readContract
      .mockResolvedValueOnce(parseEther("1"))
      .mockResolvedValueOnce(amount)
      .mockResolvedValueOnce(0n);
    mocks.writeContractAsync
      .mockResolvedValueOnce(APPROVAL_HASH)
      .mockResolvedValueOnce(STAKE_HASH);

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("2.5");
    });

    expect(hash).toBe(STAKE_HASH);
    expect(mocks.assertContractSimulation).toHaveBeenNthCalledWith(
      1,
      mockConfig,
      mocks.addNotification,
      "AETHEL Approval",
      expect.objectContaining({
        address: AETHEL_TOKEN_ADDRESS,
        functionName: "approve",
        args: [CRUZIBLE_ADDRESS, amount],
      }),
    );
    expect(mocks.assertContractSimulation).toHaveBeenNthCalledWith(
      2,
      mockConfig,
      mocks.addNotification,
      "Stake",
      expect.objectContaining({
        address: CRUZIBLE_ADDRESS,
        functionName: "stake",
        args: [amount],
      }),
    );
    expect(mocks.writeContractAsync).toHaveBeenNthCalledWith(1, {
      address: AETHEL_TOKEN_ADDRESS,
      abi: [],
      functionName: "approve",
      args: [CRUZIBLE_ADDRESS, amount],
      chainId: 4242,
    });
    expect(mocks.writeContractAsync).toHaveBeenNthCalledWith(2, {
      address: CRUZIBLE_ADDRESS,
      abi: [],
      functionName: "stake",
      args: [amount],
      chainId: 4242,
    });
    expect(mocks.waitForTransactionReceipt).toHaveBeenNthCalledWith(
      1,
      mockConfig,
      { hash: APPROVAL_HASH },
    );
    expect(mocks.waitForTransactionReceipt).toHaveBeenNthCalledWith(
      2,
      mockConfig,
      { hash: STAKE_HASH },
    );
  });

  it("does not submit stake when the required approval reverts", async () => {
    const amount = parseEther("3");
    mocks.readContract
      .mockResolvedValueOnce(parseEther("1"))
      .mockResolvedValueOnce(amount)
      .mockResolvedValueOnce(0n);
    mocks.writeContractAsync.mockResolvedValueOnce(APPROVAL_HASH);
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
    });

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("3");
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: AETHEL_TOKEN_ADDRESS,
      abi: [],
      functionName: "approve",
      args: [CRUZIBLE_ADDRESS, amount],
      chainId: 4242,
    });
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Approval Reverted",
      "The AETHEL approval was reverted on-chain.",
    );
  });

  it("does not approve or stake when the live AETHEL token balance is too low", async () => {
    const amount = parseEther("4");
    mocks.readContract
      .mockResolvedValueOnce(parseEther("1"))
      .mockResolvedValueOnce(parseEther("3.999"));

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("4");
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.assertContractSimulation).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Insufficient Balance",
      "Your live AETHEL token balance is below this stake amount. Refresh balances and try again.",
    );
  });

  it("blocks staking when the live exchange rate moved beyond the displayed quote", async () => {
    mocks.readContract.mockResolvedValueOnce(parseEther("1.01"));

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("1", {
        expectedExchangeRate: parseEther("1"),
      });
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.assertContractSimulation).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Quote Moved",
      "The vault exchange rate moved more than 0.50% from the displayed quote. Refresh the quote before signing.",
    );
  });
});

describe("useUnstake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectedWallet();
    mocks.useConfig.mockReturnValue(mockConfig);
    mocks.useWriteContract.mockReturnValue({
      isPending: false,
      writeContractAsync: mocks.writeContractAsync,
    });
    mocks.assertContractSimulation.mockResolvedValue(true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("skips stAETHEL approval when allowance covers the requested unstake", async () => {
    const shares = parseEther("4");
    mocks.readContract
      .mockResolvedValueOnce(parseEther("1"))
      .mockResolvedValueOnce(shares);
    mocks.writeContractAsync.mockResolvedValueOnce(UNSTAKE_HASH);

    const { result } = renderHook(() => useUnstake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.unstake("4");
    });

    expect(hash).toBe(UNSTAKE_HASH);
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: CRUZIBLE_ADDRESS,
      abi: [],
      functionName: "unstake",
      args: [shares],
      chainId: 4242,
    });
    expect(mocks.assertContractSimulation).toHaveBeenCalledTimes(1);
    expect(mocks.assertContractSimulation).toHaveBeenCalledWith(
      mockConfig,
      mocks.addNotification,
      "Unstake",
      expect.objectContaining({
        address: CRUZIBLE_ADDRESS,
        functionName: "unstake",
        args: [shares],
      }),
    );
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mockConfig, {
      hash: UNSTAKE_HASH,
    });
  });

  it("approves the exact stAETHEL amount before unstaking when allowance is missing", async () => {
    const shares = parseEther("5.25");
    mocks.readContract
      .mockResolvedValueOnce(parseEther("1"))
      .mockResolvedValueOnce(0n);
    mocks.writeContractAsync
      .mockResolvedValueOnce(APPROVAL_HASH)
      .mockResolvedValueOnce(UNSTAKE_HASH);

    const { result } = renderHook(() => useUnstake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.unstake("5.25");
    });

    expect(hash).toBe(UNSTAKE_HASH);
    expect(mocks.assertContractSimulation).toHaveBeenNthCalledWith(
      1,
      mockConfig,
      mocks.addNotification,
      "stAETHEL Approval",
      expect.objectContaining({
        address: ST_AETHEL_ADDRESS,
        functionName: "approve",
        args: [CRUZIBLE_ADDRESS, shares],
      }),
    );
    expect(mocks.assertContractSimulation).toHaveBeenNthCalledWith(
      2,
      mockConfig,
      mocks.addNotification,
      "Unstake",
      expect.objectContaining({
        address: CRUZIBLE_ADDRESS,
        functionName: "unstake",
        args: [shares],
      }),
    );
    expect(mocks.writeContractAsync).toHaveBeenNthCalledWith(1, {
      address: ST_AETHEL_ADDRESS,
      abi: [],
      functionName: "approve",
      args: [CRUZIBLE_ADDRESS, shares],
      chainId: 4242,
    });
    expect(mocks.writeContractAsync).toHaveBeenNthCalledWith(2, {
      address: CRUZIBLE_ADDRESS,
      abi: [],
      functionName: "unstake",
      args: [shares],
      chainId: 4242,
    });
    expect(mocks.waitForTransactionReceipt).toHaveBeenNthCalledWith(
      1,
      mockConfig,
      { hash: APPROVAL_HASH },
    );
    expect(mocks.waitForTransactionReceipt).toHaveBeenNthCalledWith(
      2,
      mockConfig,
      { hash: UNSTAKE_HASH },
    );
  });

  it("does not submit unstake when the required stAETHEL approval reverts", async () => {
    const shares = parseEther("6");
    mocks.readContract
      .mockResolvedValueOnce(parseEther("1"))
      .mockResolvedValueOnce(0n);
    mocks.writeContractAsync.mockResolvedValueOnce(APPROVAL_HASH);
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
    });

    const { result } = renderHook(() => useUnstake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.unstake("6");
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: ST_AETHEL_ADDRESS,
      abi: [],
      functionName: "approve",
      args: [CRUZIBLE_ADDRESS, shares],
      chainId: 4242,
    });
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Approval Reverted",
      "The stAETHEL approval was reverted on-chain.",
    );
  });

  it("blocks unstaking when the live exchange rate moved beyond the displayed quote", async () => {
    mocks.readContract.mockResolvedValueOnce(parseEther("0.99"));

    const { result } = renderHook(() => useUnstake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.unstake("1", {
        expectedExchangeRate: parseEther("1"),
      });
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.assertContractSimulation).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Quote Moved",
      "The vault exchange rate moved more than 0.50% from the displayed quote. Refresh the quote before signing.",
    );
  });
});

describe("useWithdraw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectedWallet();
    mocks.useConfig.mockReturnValue(mockConfig);
    mocks.useWriteContract.mockReturnValue({
      isPending: false,
      writeContractAsync: mocks.writeContractAsync,
    });
    mocks.assertContractSimulation.mockResolvedValue(true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("simulates and confirms withdrawal claims before reporting success", async () => {
    mocks.writeContractAsync.mockResolvedValueOnce(WITHDRAW_HASH);

    const { result } = renderHook(() => useWithdraw());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.withdraw(7n);
    });

    expect(hash).toBe(WITHDRAW_HASH);
    expect(mocks.assertContractSimulation).toHaveBeenCalledWith(
      mockConfig,
      mocks.addNotification,
      "Withdrawal",
      expect.objectContaining({
        address: CRUZIBLE_ADDRESS,
        functionName: "withdraw",
        args: [7n],
      }),
    );
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: CRUZIBLE_ADDRESS,
      abi: [],
      functionName: "withdraw",
      args: [7n],
      chainId: 4242,
    });
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mockConfig, {
      hash: WITHDRAW_HASH,
    });
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "success",
      "Withdrawal Complete",
      "Your AETHEL has been returned to your wallet.",
    );
  });

  it("does not report withdrawal success when the receipt reverts", async () => {
    mocks.writeContractAsync.mockResolvedValueOnce(WITHDRAW_HASH);
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
    });

    const { result } = renderHook(() => useWithdraw());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.withdraw(8n);
    });

    expect(hash).toBeUndefined();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Withdrawal Reverted",
      "The withdrawal transaction was reverted on-chain.",
    );
    expect(mocks.addNotification).not.toHaveBeenCalledWith(
      "success",
      "Withdrawal Complete",
      expect.any(String),
    );
  });
});

describe("useClaimRewards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectedWallet();
    mocks.useConfig.mockReturnValue(mockConfig);
    mocks.useWriteContract.mockReturnValue({
      isPending: false,
      writeContractAsync: mocks.writeContractAsync,
    });
    mocks.assertContractSimulation.mockResolvedValue(true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("simulates and confirms reward claims with backend-supplied proofs", async () => {
    const proof = ["0xabc123"] as readonly `0x${string}`[];
    mocks.writeContractAsync.mockResolvedValueOnce(CLAIM_HASH);

    const { result } = renderHook(() => useClaimRewards());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.claimRewards({
        epoch: 9n,
        amount: parseEther("0.25"),
        proof,
      });
    });

    expect(hash).toBe(CLAIM_HASH);
    expect(mocks.assertContractSimulation).toHaveBeenCalledWith(
      mockConfig,
      mocks.addNotification,
      "Reward Claim",
      expect.objectContaining({
        address: CRUZIBLE_ADDRESS,
        functionName: "claimRewards",
        args: [9n, parseEther("0.25"), proof],
      }),
    );
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: CRUZIBLE_ADDRESS,
      abi: [],
      functionName: "claimRewards",
      args: [9n, parseEther("0.25"), proof],
      chainId: 4242,
    });
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mockConfig, {
      hash: CLAIM_HASH,
    });
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "success",
      "Rewards Claimed",
      "Your rewards have been sent to your wallet.",
    );
  });

  it("does not submit reward claims when simulation fails", async () => {
    mocks.assertContractSimulation.mockResolvedValueOnce(false);

    const { result } = renderHook(() => useClaimRewards());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.claimRewards({
        epoch: 10n,
        amount: parseEther("1"),
        proof: [],
      });
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
  });
});
