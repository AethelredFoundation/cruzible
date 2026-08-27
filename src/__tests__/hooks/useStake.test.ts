import { act, renderHook } from "@testing-library/react";
import { parseEther, toFunctionSelector } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CRUZIBLE_ADDRESS = "0x0000000000000000000000000000000000000101";
const AETHEL_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000202";
const ST_AETHEL_ADDRESS = "0x0000000000000000000000000000000000000404";
const WALLET_ADDRESS = "0x0000000000000000000000000000000000000303";
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
  estimateGas: vi.fn(),
  getBalance: vi.fn(),
  getGasPrice: vi.fn(),
  readContract: vi.fn(),
  useApp: vi.fn(),
  useConfig: vi.fn(),
  useWriteContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
}));

vi.mock("@/config/abis", () => ({
  CruzibleABI: [
    {
      type: "function",
      name: "stakeWithMinShares",
      stateMutability: "payable",
      inputs: [{ name: "minShares", type: "uint256" }],
      outputs: [{ name: "shares", type: "uint256" }],
    },
    {
      type: "function",
      name: "stakeWithSealAndMinShares",
      stateMutability: "payable",
      inputs: [
        { name: "jobId", type: "string" },
        { name: "minShares", type: "uint256" },
      ],
      outputs: [],
    },
  ],
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
  isWalletRejectionError: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "message" in error) &&
    ((error as { code?: unknown }).code === 4001 ||
      ((error as { message?: unknown }).message as string | undefined)
        ?.toLowerCase()
        .includes("rejected")),
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => undefined,
  useAccount: vi.fn(),
  useConfig: mocks.useConfig,
  useReadContract: vi.fn(),
  useReadContracts: vi.fn(),
  useWriteContract: mocks.useWriteContract,
}));

vi.mock("wagmi/actions", () => ({
  estimateGas: mocks.estimateGas,
  getBalance: mocks.getBalance,
  getGasPrice: mocks.getGasPrice,
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

function mockUnstakeContractReads({
  rate = parseEther("1.25"),
  period = 3_600n,
  convertedShares = parseEther("3.2"),
  liveShares = parseEther("4"),
  liveTokenBalance = parseEther("5"),
}: {
  rate?: bigint;
  period?: bigint;
  convertedShares?: bigint;
  liveShares?: bigint;
  liveTokenBalance?: bigint;
} = {}) {
  mocks.readContract.mockImplementation(
    (_config: unknown, request: { functionName?: string }) => {
      if (request.functionName === "getExchangeRate") return rate;
      if (request.functionName === "unbondingPeriod") return period;
      if (request.functionName === "getSharesByAethel") {
        return convertedShares;
      }
      if (request.functionName === "sharesOf") return liveShares;
      if (request.functionName === "balanceOf") return liveTokenBalance;
      throw new Error(`Unexpected read ${request.functionName}`);
    },
  );
}

describe("useStake", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setConnectedWallet();
    mocks.useConfig.mockReturnValue(mockConfig);
    mocks.useWriteContract.mockReturnValue({
      isPending: false,
      writeContractAsync: mocks.writeContractAsync,
    });
    mocks.assertContractSimulation.mockResolvedValue(true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    // Native AETHEL: staking reads the account's native balance (not an
    // ERC-20). Default to a balance that covers the test amounts.
    mocks.getBalance.mockResolvedValue({
      value: parseEther("1000"),
      decimals: 18,
    });
    mocks.estimateGas.mockResolvedValue(100_000n);
    mocks.getGasPrice.mockResolvedValue(1_000_000_000n);
    mocks.readContract.mockReset();
    mocks.readContract.mockImplementation(
      (_config: unknown, request: { functionName?: string }) => {
        if (request.functionName === "getExchangeRate") return parseEther("1");
        if (request.functionName === "unbondingPeriod") return 3_600n;
        if (request.functionName === "identityRequired") return false;
        if (request.functionName === "isIdentityVerified") return true;
        if (request.functionName === "complianceRequired") return false;
        if (request.functionName === "complianceAdmitted") return false;
        return 0n;
      },
    );
  });

  it("stakes native AETHEL as msg.value with no ERC-20 approval step", async () => {
    // AETHEL is the native coin — the deployed vault's stake() is payable
    // and takes the amount as value. There is no approve/allowance dance;
    // the only preflight is a live native-balance check.
    const amount = parseEther("1");
    mocks.readContract.mockResolvedValueOnce(parseEther("1")); // exchange rate
    mocks.getBalance.mockResolvedValueOnce({ value: parseEther("10") });
    mocks.writeContractAsync.mockResolvedValueOnce(STAKE_HASH);

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("1");
    });

    expect(hash).toBe(STAKE_HASH);
    expect(mocks.getBalance).toHaveBeenCalledWith(mockConfig, {
      address: WALLET_ADDRESS,
      chainId: 4242,
    });
    // Exactly one write — the stake — and never an approve.
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: CRUZIBLE_ADDRESS,
      abi: expect.any(Array),
      functionName: "stakeWithMinShares",
      args: [parseEther("0.995")],
      value: amount,
      chainId: 4242,
    });
    expect(mocks.writeContractAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "approve" }),
    );
    // The simulation preview carries the same native value as the send.
    expect(mocks.assertContractSimulation).toHaveBeenCalledTimes(1);
    expect(mocks.assertContractSimulation).toHaveBeenCalledWith(
      mockConfig,
      mocks.addNotification,
      "Stake",
      expect.objectContaining({
        address: CRUZIBLE_ADDRESS,
        functionName: "stakeWithMinShares",
        args: [parseEther("0.995")],
        value: amount,
      }),
    );
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mockConfig, {
      hash: STAKE_HASH,
    });
  });

  it("reads the NATIVE balance (not an ERC-20) to gate the stake amount", async () => {
    const amount = parseEther("2.5");
    mocks.readContract.mockResolvedValueOnce(parseEther("1")); // exchange rate
    mocks.getBalance.mockResolvedValueOnce({
      value: parseEther("10"),
      decimals: 18,
    });
    mocks.writeContractAsync.mockResolvedValueOnce(STAKE_HASH);

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("2.5");
    });

    expect(hash).toBe(STAKE_HASH);
    // Balance came from the native getBalance, keyed by the wallet address.
    expect(mocks.getBalance).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ address: WALLET_ADDRESS }),
    );
    expect(mocks.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "stakeWithMinShares",
        args: [parseEther("2.4875")],
        value: amount,
      }),
    );
  });

  it("calculates MAX from a fresh native balance and a buffered live gas estimate", async () => {
    mocks.getBalance.mockResolvedValueOnce({
      value: parseEther("10"),
      decimals: 18,
    });
    mocks.estimateGas.mockResolvedValueOnce(2_000_000n);
    mocks.getGasPrice.mockResolvedValueOnce(100_000_000_000n);

    const { result } = renderHook(() => useStake());
    let maximum = 0n;

    await act(async () => {
      maximum = await result.current.getMaxStakeAmount();
    });

    // 2m gas * the chain's 8x safety buffer * 100 gwei = 1.6 AETHEL.
    expect(maximum).toBe(parseEther("8.4"));
    expect(mocks.estimateGas).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({
        account: WALLET_ADDRESS,
        chainId: 4242,
        to: CRUZIBLE_ADDRESS,
        value: parseEther("1"),
      }),
    );
  });

  it("uses a conservative fallback reserve when RPC gas estimation fails", async () => {
    mocks.getBalance.mockResolvedValueOnce({
      value: parseEther("10"),
      decimals: 18,
    });
    mocks.estimateGas.mockRejectedValueOnce(new Error("RPC unavailable"));

    const { result } = renderHook(() => useStake());
    let maximum = 0n;

    await act(async () => {
      maximum = await result.current.getMaxStakeAmount();
    });

    expect(maximum).toBe(parseEther("9.99"));
  });

  it("blocks a manually entered full-balance stake that would leave no gas", async () => {
    mocks.readContract.mockResolvedValueOnce(parseEther("1"));
    mocks.getBalance.mockResolvedValueOnce({
      value: parseEther("10"),
      decimals: 18,
    });

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("10");
    });

    expect(hash).toBeUndefined();
    expect(mocks.assertContractSimulation).not.toHaveBeenCalled();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Insufficient Gas Reserve",
      "Keep some AETHEL available for network gas. Use MAX to calculate the largest safe stake amount.",
    );
  });

  it("blocks staking when live exit or identity terms cannot be read", async () => {
    mocks.readContract.mockImplementation(
      (_config: unknown, request: { functionName?: string }) => {
        if (request.functionName === "getExchangeRate") return parseEther("1");
        if (request.functionName === "unbondingPeriod") {
          throw new Error("RPC unavailable");
        }
        if (request.functionName === "identityRequired") return false;
        if (request.functionName === "isIdentityVerified") return true;
        if (request.functionName === "complianceRequired") return false;
        if (request.functionName === "complianceAdmitted") return false;
        return 0n;
      },
    );

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("1");
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Stake Terms Unavailable",
      "Could not verify the live withdrawal cooldown, ZeroID identity, and Digital Seal admission state. Staking is blocked until every read succeeds.",
    );
  });

  it("requires confirmation again when the live cooldown changes", async () => {
    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("1", {
        expectedExchangeRate: parseEther("1"),
        expectedUnbondingPeriod: 86_400n,
      });
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Exit Terms Changed",
      "The vault withdrawal cooldown changed after the confirmation was shown. Review the live terms before signing.",
    );
  });

  it("uses stakeWithSeal when live compliance requires admission", async () => {
    mocks.readContract.mockImplementation(
      (_config: unknown, request: { functionName?: string }) => {
        if (request.functionName === "getExchangeRate") return parseEther("1");
        if (request.functionName === "unbondingPeriod") return 3_600n;
        if (request.functionName === "identityRequired") return false;
        if (request.functionName === "isIdentityVerified") return true;
        if (request.functionName === "complianceRequired") return true;
        if (request.functionName === "complianceAdmitted") return false;
        return 0n;
      },
    );
    mocks.writeContractAsync.mockResolvedValueOnce(STAKE_HASH);

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;
    await act(async () => {
      hash = await result.current.stake("1", {
        expectedExchangeRate: parseEther("1"),
        expectedUnbondingPeriod: 3_600n,
        expectedComplianceRequired: true,
        expectedComplianceAdmitted: false,
        complianceJobId: "job-123",
      });
    });

    expect(hash).toBe(STAKE_HASH);
    expect(mocks.assertContractSimulation).toHaveBeenCalledWith(
      mockConfig,
      mocks.addNotification,
      "Stake",
      expect.objectContaining({
        functionName: "stakeWithSealAndMinShares",
        args: ["job-123", parseEther("0.995")],
      }),
    );
    expect(mocks.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "stakeWithSealAndMinShares",
        args: ["job-123", parseEther("0.995")],
      }),
    );
    const estimatedCallData = mocks.estimateGas.mock.calls.at(-1)?.[1]?.data;
    expect(estimatedCallData?.slice(0, 10)).toBe(
      toFunctionSelector("stakeWithSealAndMinShares(string,uint256)"),
    );
  });

  it("blocks compliance admission when the job id is invalid", async () => {
    mocks.readContract.mockImplementation(
      (_config: unknown, request: { functionName?: string }) => {
        if (request.functionName === "getExchangeRate") return parseEther("1");
        if (request.functionName === "unbondingPeriod") return 3_600n;
        if (request.functionName === "identityRequired") return false;
        if (request.functionName === "isIdentityVerified") return true;
        if (request.functionName === "complianceRequired") return true;
        if (request.functionName === "complianceAdmitted") return false;
        return 0n;
      },
    );

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;
    await act(async () => {
      hash = await result.current.stake("1", {
        expectedExchangeRate: parseEther("1"),
        complianceJobId: "invalid job id",
      });
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Digital Seal Job Required",
      "Enter the 1-64 character compliance job ID whose active Digital Seal is bound to this wallet.",
    );
  });

  it("aborts if compliance admission changes after confirmation", async () => {
    mocks.readContract.mockImplementation(
      (_config: unknown, request: { functionName?: string }) => {
        if (request.functionName === "getExchangeRate") return parseEther("1");
        if (request.functionName === "unbondingPeriod") return 3_600n;
        if (request.functionName === "identityRequired") return false;
        if (request.functionName === "isIdentityVerified") return true;
        if (request.functionName === "complianceRequired") return true;
        if (request.functionName === "complianceAdmitted") return false;
        return 0n;
      },
    );

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;
    await act(async () => {
      hash = await result.current.stake("1", {
        expectedExchangeRate: parseEther("1"),
        expectedComplianceRequired: false,
        expectedComplianceAdmitted: false,
      });
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Admission Terms Changed",
      "The vault's Digital Seal admission state changed after confirmation was shown. Review the live compliance requirements before signing.",
    );
  });

  it("reports the on-chain revert when the stake transaction reverts", async () => {
    mocks.readContract.mockResolvedValueOnce(parseEther("1")); // exchange rate
    mocks.writeContractAsync.mockResolvedValueOnce(STAKE_HASH);
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
    });

    const { result } = renderHook(() => useStake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.stake("3");
    });

    expect(hash).toBeUndefined();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Stake Reverted",
      "The stake transaction was reverted on-chain.",
    );
  });

  it("does not stake when the live native balance is too low", async () => {
    mocks.readContract.mockResolvedValueOnce(parseEther("1")); // exchange rate
    mocks.getBalance.mockResolvedValueOnce({
      value: parseEther("3.999"),
      decimals: 18,
    });

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
      "Your live AETHEL balance is below this stake amount. Refresh balances and try again.",
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
    vi.resetAllMocks();
    setConnectedWallet();
    mocks.useConfig.mockReturnValue(mockConfig);
    mocks.useWriteContract.mockReturnValue({
      isPending: false,
      writeContractAsync: mocks.writeContractAsync,
    });
    mocks.assertContractSimulation.mockResolvedValue(true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("converts rebasing token units to raw shares at a rate above one", async () => {
    const stAethelAmount = parseEther("4");
    const rawShares = parseEther("3.2");
    mockUnstakeContractReads({ convertedShares: rawShares });
    mocks.writeContractAsync.mockResolvedValueOnce(UNSTAKE_HASH);

    const { result } = renderHook(() => useUnstake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.unstake("4");
    });

    expect(hash).toBe(UNSTAKE_HASH);
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.readContract).not.toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ functionName: "allowance" }),
    );
    expect(mocks.writeContractAsync).toHaveBeenCalledWith({
      address: CRUZIBLE_ADDRESS,
      abi: expect.any(Array),
      functionName: "unstakeWithMinAethel",
      args: [rawShares, parseEther("3.98")],
      chainId: 4242,
    });
    expect(mocks.assertContractSimulation).toHaveBeenCalledTimes(1);
    expect(mocks.assertContractSimulation).toHaveBeenCalledWith(
      mockConfig,
      mocks.addNotification,
      "Unstake",
      expect.objectContaining({
        address: CRUZIBLE_ADDRESS,
        functionName: "unstakeWithMinAethel",
        args: [rawShares, parseEther("3.98")],
      }),
    );
    expect(mocks.readContract).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({
        address: ST_AETHEL_ADDRESS,
        functionName: "getSharesByAethel",
        args: [stAethelAmount],
      }),
    );
    expect(mocks.readContract).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({
        address: ST_AETHEL_ADDRESS,
        functionName: "sharesOf",
        args: [WALLET_ADDRESS],
      }),
    );
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mockConfig, {
      hash: UNSTAKE_HASH,
    });
  });

  it("does not unstake when the live stAETHEL token balance is too low", async () => {
    mockUnstakeContractReads({
      liveShares: parseEther("3.199"),
      liveTokenBalance: parseEther("3.999"),
    });

    const { result } = renderHook(() => useUnstake());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.unstake("4");
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.assertContractSimulation).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Insufficient Balance",
      "Your live stAETHEL token balance is below this unstake amount. Refresh balances and try again.",
    );
    expect(mocks.readContract).toHaveBeenCalledTimes(5);
  });

  it("burns the exact raw share balance when MAX equals the rebasing balance", async () => {
    mockUnstakeContractReads({
      convertedShares: parseEther("3.999999999999999999"),
      liveShares: parseEther("4"),
      liveTokenBalance: parseEther("5"),
    });
    mocks.writeContractAsync.mockResolvedValueOnce(UNSTAKE_HASH);

    const { result } = renderHook(() => useUnstake());
    await act(async () => {
      await result.current.unstake("5");
    });

    expect(mocks.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "unstakeWithMinAethel",
        args: [parseEther("4"), parseEther("4.975")],
      }),
    );
  });

  it("blocks unstaking when the live cooldown changed after confirmation", async () => {
    mocks.readContract
      .mockResolvedValueOnce(parseEther("1"))
      .mockResolvedValueOnce(3_600n);

    const { result } = renderHook(() => useUnstake());
    let hash: string | undefined;
    await act(async () => {
      hash = await result.current.unstake("1", {
        expectedExchangeRate: parseEther("1"),
        expectedUnbondingPeriod: 86_400n,
      });
    });

    expect(hash).toBeUndefined();
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Exit Terms Changed",
      "The vault withdrawal cooldown changed after the confirmation was shown. Review the live terms before signing.",
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
    vi.resetAllMocks();
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
      abi: expect.any(Array),
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
    vi.resetAllMocks();
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
      abi: expect.any(Array),
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
