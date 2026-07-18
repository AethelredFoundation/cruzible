import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CRUZIBLE_ADDRESS = "0x0000000000000000000000000000000000000101";
const WALLET_ADDRESS = "0x0000000000000000000000000000000000000303";

const mocks = vi.hoisted(() => ({
  useAccount: vi.fn(),
  useReadContract: vi.fn(),
  useReadContracts: vi.fn(),
}));

vi.mock("@/config/abis", () => ({
  CruzibleABI: [],
  ERC20ABI: [],
  StAETHELABI: [],
}));

vi.mock("@/config/contracts", () => ({
  getContractAddress: () => CRUZIBLE_ADDRESS,
}));

vi.mock("@/config/wagmi", () => ({
  activeChain: { id: 7332, name: "Aethelred" },
}));

vi.mock("@/contexts/AppContext", () => ({
  useApp: vi.fn(),
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => undefined,
  useAccount: mocks.useAccount,
  useReadContracts: mocks.useReadContracts,
  useReadContract: mocks.useReadContract,
  useWriteContract: vi.fn(() => ({
    writeContractAsync: vi.fn(),
    isPending: false,
  })),
  useConfig: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
  estimateGas: vi.fn(),
  getBalance: vi.fn(),
  getGasPrice: vi.fn(),
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

import {
  normalizeComplianceJobId,
  useComplianceGate,
  useIdentityGate,
  useUnbondingPeriod,
  useUserWithdrawals,
} from "@/hooks/useVault";

function gateReads(identityRequired: boolean, isVerified: boolean) {
  return {
    data: [
      { status: "success", result: identityRequired },
      { status: "success", result: isVerified },
    ],
    isError: false,
    isLoading: false,
  };
}

describe("useIdentityGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAccount.mockReturnValue({ address: WALLET_ADDRESS });
    mocks.useReadContract.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isFetched: false,
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  it("gate off → never blocks, regardless of registry state", () => {
    mocks.useReadContracts.mockReturnValue(gateReads(false, false));
    const { result } = renderHook(() => useIdentityGate());
    expect(result.current.identityRequired).toBe(false);
    expect(result.current.blocksStaking).toBe(false);
    expect(result.current.isAvailable).toBe(true);
  });

  it("gate on + verified wallet → satisfied, staking not blocked", () => {
    mocks.useReadContracts.mockReturnValue(gateReads(true, true));
    const { result } = renderHook(() => useIdentityGate());
    expect(result.current.identityRequired).toBe(true);
    expect(result.current.isVerified).toBe(true);
    expect(result.current.blocksStaking).toBe(false);
  });

  it("gate on + unverified wallet → blocks staking (the vault would revert)", () => {
    mocks.useReadContracts.mockReturnValue(gateReads(true, false));
    const { result } = renderHook(() => useIdentityGate());
    expect(result.current.blocksStaking).toBe(true);
    expect(result.current.isVerified).toBe(false);
  });

  it("gate on + no wallet connected → not verified, but does not block (connect first)", () => {
    mocks.useAccount.mockReturnValue({ address: undefined });
    // isIdentityVerified(zeroAddress) could even return true on an ungated
    // registry — the hook must not report verification without a wallet.
    mocks.useReadContracts.mockReturnValue(gateReads(true, true));
    const { result } = renderHook(() => useIdentityGate());
    expect(result.current.isVerified).toBe(false);
    expect(result.current.blocksStaking).toBe(false);
  });

  it("passes the connected address to isIdentityVerified", () => {
    mocks.useReadContracts.mockReturnValue(gateReads(true, true));
    renderHook(() => useIdentityGate());
    const call = mocks.useReadContracts.mock.calls[0][0];
    expect(call.contracts[1].functionName).toBe("isIdentityVerified");
    expect(call.contracts[1].args).toEqual([WALLET_ADDRESS]);
    expect(call.contracts[0].functionName).toBe("identityRequired");
  });

  it("fails closed when either on-chain identity read fails", () => {
    mocks.useReadContracts.mockReturnValue({
      data: [
        { status: "failure", error: new Error("RPC unavailable") },
        { status: "success", result: true },
      ],
      isError: false,
      isLoading: false,
    });

    const { result } = renderHook(() => useIdentityGate());

    expect(result.current.identityRequired).toBe(false);
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isError).toBe(true);
    expect(result.current.blocksStaking).toBe(true);
  });
});

describe("useComplianceGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAccount.mockReturnValue({ address: WALLET_ADDRESS });
  });

  it("requires a seal only when compliance is on and the wallet is not admitted", () => {
    mocks.useReadContracts.mockReturnValue(gateReads(true, false));
    const { result } = renderHook(() => useComplianceGate());

    expect(result.current).toMatchObject({
      complianceRequired: true,
      isAdmitted: false,
      requiresSeal: true,
      isAvailable: true,
      blocksStaking: false,
    });
  });

  it("allows an already-admitted wallet to use ordinary stake", () => {
    mocks.useReadContracts.mockReturnValue(gateReads(true, true));
    const { result } = renderHook(() => useComplianceGate());
    expect(result.current.requiresSeal).toBe(false);
    expect(result.current.isAdmitted).toBe(true);
  });

  it("fails closed when a compliance read fails", () => {
    mocks.useReadContracts.mockReturnValue({
      data: [
        { status: "success", result: false },
        { status: "failure", error: new Error("RPC unavailable") },
      ],
      isError: false,
      isLoading: false,
    });
    const { result } = renderHook(() => useComplianceGate());

    expect(result.current.isAvailable).toBe(false);
    expect(result.current.blocksStaking).toBe(true);
  });

  it("validates compliance job identifiers", () => {
    expect(normalizeComplianceJobId("  job-123_ABC  ")).toBe("job-123_ABC");
    expect(normalizeComplianceJobId("")).toBeNull();
    expect(normalizeComplianceJobId("contains spaces")).toBeNull();
    expect(normalizeComplianceJobId("a".repeat(65))).toBeNull();
  });
});

describe("live vault read states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAccount.mockReturnValue({ address: WALLET_ADDRESS });
  });

  it("returns the live unbonding period without a hardcoded fallback", () => {
    mocks.useReadContract.mockReturnValue({
      data: 1_814_400n,
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useUnbondingPeriod());

    expect(result.current).toEqual({
      seconds: 1_814_400n,
      isLoading: false,
      isError: false,
    });
  });

  it("fails closed when the live unbonding period is unavailable", () => {
    mocks.useReadContract.mockReturnValue({
      data: 1_814_400n,
      isLoading: false,
      isError: true,
    });

    const { result } = renderHook(() => useUnbondingPeriod());

    expect(result.current.seconds).toBeNull();
    expect(result.current.isError).toBe(true);
  });

  it("preserves withdrawal loading, error, and fetched state", () => {
    const readError = new Error("RPC unavailable");
    const refetch = vi.fn();
    mocks.useReadContract.mockReturnValue({
      data: undefined,
      error: readError,
      isError: true,
      isFetched: true,
      isLoading: false,
      refetch,
    });

    const { result } = renderHook(() => useUserWithdrawals());

    expect(result.current).toMatchObject({
      withdrawals: [],
      error: readError,
      isError: true,
      isFetched: true,
      isLoading: false,
      refetch,
    });
  });
});
