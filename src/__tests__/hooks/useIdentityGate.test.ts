import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CRUZIBLE_ADDRESS = "0x0000000000000000000000000000000000000101";
const WALLET_ADDRESS = "0x0000000000000000000000000000000000000303";

const mocks = vi.hoisted(() => ({
  useAccount: vi.fn(),
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
  useAccount: mocks.useAccount,
  useReadContracts: mocks.useReadContracts,
  useReadContract: vi.fn(() => ({ data: undefined })),
  useWriteContract: vi.fn(() => ({
    writeContractAsync: vi.fn(),
    isPending: false,
  })),
  useConfig: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
  getBalance: vi.fn(),
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

import { useIdentityGate } from "@/hooks/useVault";

function gateReads(identityRequired: boolean, isVerified: boolean) {
  return {
    data: [{ result: identityRequired }, { result: isVerified }],
    isLoading: false,
  };
}

describe("useIdentityGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAccount.mockReturnValue({ address: WALLET_ADDRESS });
  });

  it("gate off → never blocks, regardless of registry state", () => {
    mocks.useReadContracts.mockReturnValue(gateReads(false, false));
    const { result } = renderHook(() => useIdentityGate());
    expect(result.current.identityRequired).toBe(false);
    expect(result.current.blocksStaking).toBe(false);
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
});
