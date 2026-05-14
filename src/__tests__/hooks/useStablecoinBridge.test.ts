import { act, renderHook } from "@testing-library/react";
import { parseUnits } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StablecoinOnChainConfig } from "@/hooks/useStablecoinBridge";

const BRIDGE_ADDRESS = "0x0000000000000000000000000000000000000101";
const USDC_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000202";
const WALLET_ADDRESS = "0x0000000000000000000000000000000000000303";
const BRIDGE_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const mockConfig = { uid: "wagmi-config" };

const mocks = vi.hoisted(() => ({
  addNotification: vi.fn(),
  assertContractSimulation: vi.fn(),
  readContract: vi.fn(),
  useAccount: vi.fn(),
  useApp: vi.fn(),
  useConfig: vi.fn(),
  useReadContract: vi.fn(),
  useWriteContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
}));

vi.mock("@/config/abis", () => ({
  ERC20ABI: [],
  StablecoinBridgeABI: [],
}));

vi.mock("@/config/contracts", () => ({
  getContractAddress: (key: string) =>
    key === "stablecoinBridge" ? BRIDGE_ADDRESS : undefined,
  getStablecoinTokenAddress: (symbol: string) =>
    symbol === "USDC" ? USDC_TOKEN_ADDRESS : undefined,
  normalizeContractAddress: (value?: string) => value,
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
  useAccount: mocks.useAccount,
  useConfig: mocks.useConfig,
  useReadContract: mocks.useReadContract,
  useWriteContract: mocks.useWriteContract,
}));

vi.mock("wagmi/actions", () => ({
  readContract: mocks.readContract,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

import { useBridgeOut } from "@/hooks/useStablecoinBridge";

const liveUsdcConfig: StablecoinOnChainConfig = {
  enabled: true,
  mintPaused: false,
  routingType: 1,
  token: USDC_TOKEN_ADDRESS,
  mintCeilingPerEpoch: 0n,
  dailyTxLimit: 0n,
  hourlyOutflowBps: 0,
  dailyOutflowBps: 0,
  isLoading: false,
};

function setConnectedWallet() {
  mocks.useAccount.mockReturnValue({ address: WALLET_ADDRESS });
  mocks.useApp.mockReturnValue({
    addNotification: mocks.addNotification,
    wallet: {
      connected: true,
      address: WALLET_ADDRESS,
      balance: 0,
      balanceWei: 0n,
      stBalance: 0,
      stBalanceWei: 0n,
      stablecoinBalances: { USDC: 10 },
      stablecoinBalanceUnits: { USDC: parseUnits("10", 6) },
      isConnecting: false,
      isWrongNetwork: false,
      chainId: 4242,
    },
  });
}

describe("useBridgeOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectedWallet();
    mocks.useConfig.mockReturnValue(mockConfig);
    mocks.useReadContract.mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    mocks.useWriteContract.mockReturnValue({
      isPending: false,
      writeContractAsync: mocks.writeContractAsync,
    });
    mocks.assertContractSimulation.mockResolvedValue(true);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("blocks stale-balance bridge attempts before allowance or approval", async () => {
    mocks.readContract.mockResolvedValueOnce(parseUnits("0.5", 6));

    const { result } = renderHook(() => useBridgeOut());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.bridgeOut("USDC", "1", 0, liveUsdcConfig);
    });

    expect(hash).toBeUndefined();
    expect(mocks.readContract).toHaveBeenCalledTimes(1);
    expect(mocks.readContract).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({
        address: USDC_TOKEN_ADDRESS,
        functionName: "balanceOf",
        args: [WALLET_ADDRESS],
      }),
    );
    expect(mocks.writeContractAsync).not.toHaveBeenCalled();
    expect(mocks.assertContractSimulation).not.toHaveBeenCalled();
    expect(mocks.addNotification).toHaveBeenCalledWith(
      "error",
      "Insufficient Balance",
      "Your live USDC balance is below this bridge amount. Refresh balances and try again.",
    );
  });

  it("bridges without approval when live balance and allowance are sufficient", async () => {
    const amount = parseUnits("1.25", 6);
    mocks.readContract
      .mockResolvedValueOnce(amount)
      .mockResolvedValueOnce(amount);
    mocks.writeContractAsync.mockResolvedValueOnce(BRIDGE_HASH);

    const { result } = renderHook(() => useBridgeOut());
    let hash: string | undefined;

    await act(async () => {
      hash = await result.current.bridgeOut("USDC", "1.25", 0, liveUsdcConfig);
    });

    expect(hash).toBe(BRIDGE_HASH);
    expect(mocks.readContract).toHaveBeenNthCalledWith(
      1,
      mockConfig,
      expect.objectContaining({
        functionName: "balanceOf",
        args: [WALLET_ADDRESS],
      }),
    );
    expect(mocks.readContract).toHaveBeenNthCalledWith(
      2,
      mockConfig,
      expect.objectContaining({
        functionName: "allowance",
        args: [WALLET_ADDRESS, BRIDGE_ADDRESS],
      }),
    );
    expect(mocks.assertContractSimulation).toHaveBeenCalledTimes(1);
    expect(mocks.assertContractSimulation).toHaveBeenCalledWith(
      mockConfig,
      mocks.addNotification,
      "USDC Bridge",
      expect.objectContaining({
        address: BRIDGE_ADDRESS,
        functionName: "bridgeOutViaCCTP",
      }),
    );
    expect(mocks.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        address: BRIDGE_ADDRESS,
        functionName: "bridgeOutViaCCTP",
      }),
    );
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mockConfig, {
      hash: BRIDGE_HASH,
    });
  });
});
