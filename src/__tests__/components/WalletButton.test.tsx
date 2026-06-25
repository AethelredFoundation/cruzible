import { fireEvent, render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connector } from "wagmi";

const metaMaskConnector = {
  id: "injected",
  name: "MetaMask",
  uid: "injected-1",
} as unknown as Connector;
const walletConnectConnector = {
  id: "walletConnect",
  name: "WalletConnect",
  uid: "walletconnect-1",
} as unknown as Connector;

const mocks = vi.hoisted(() => ({
  connectWallet: vi.fn(),
  disconnectWallet: vi.fn(),
  switchNetwork: vi.fn(),
  useApp: vi.fn(),
  useConnect: vi.fn(),
}));

vi.mock("@/contexts/AppContext", () => ({
  useApp: mocks.useApp,
}));

vi.mock("@/config/wagmi", () => ({
  activeChain: { id: 4242, name: "Aethelred Testnet" },
}));

vi.mock("wagmi", () => ({
  useConnect: mocks.useConnect,
}));

import { WalletButton } from "@/components/WalletButton";

function disconnectedWallet() {
  return {
    connected: false,
    address: "",
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
    chainId: 0,
  };
}

describe("WalletButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useApp.mockReturnValue({
      wallet: disconnectedWallet(),
      connectWallet: mocks.connectWallet,
      disconnectWallet: mocks.disconnectWallet,
      switchNetwork: mocks.switchNetwork,
    });
    mocks.useConnect.mockReturnValue({
      connectors: [metaMaskConnector, walletConnectConnector],
    });
  });

  it("connects with the connector selected from the wallet modal", () => {
    const { container } = render(<WalletButton />);
    const walletControls = within(container);

    fireEvent.click(
      walletControls.getByRole("button", { name: /connect wallet/i }),
    );
    fireEvent.click(
      walletControls.getByRole("button", { name: /walletconnect/i }),
    );

    expect(mocks.connectWallet).toHaveBeenCalledWith(walletConnectConnector);
  });

  it("connects directly with the sole available connector", () => {
    mocks.useConnect.mockReturnValue({ connectors: [metaMaskConnector] });
    const { container } = render(<WalletButton />);
    const walletControls = within(container);

    fireEvent.click(
      walletControls.getByRole("button", { name: /connect wallet/i }),
    );

    expect(mocks.connectWallet).toHaveBeenCalledWith(metaMaskConnector);
  });
});
