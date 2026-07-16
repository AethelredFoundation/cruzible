import { describe, expect, it } from "vitest";
import {
  AETHELRED_WALLET_RDNS,
  METAMASK_RDNS,
  isAethelredWallet,
  orderWalletConnectors,
} from "@/config/wallet-picker";

describe("orderWalletConnectors", () => {
  const generic = { id: "injected", name: "Injected" };
  const aethelred = {
    id: AETHELRED_WALLET_RDNS,
    name: "Aethelred Wallet",
    icon: "data:image/svg+xml,wallet",
  };
  const metamask = {
    id: METAMASK_RDNS,
    name: "MetaMask",
    icon: "data:image/svg+xml,fox",
  };
  const other = { id: "com.example.wallet", name: "Example Wallet" };

  it("puts Aethelred Wallet first, MetaMask second, others after", () => {
    const ordered = orderWalletConnectors([other, metamask, aethelred]);
    expect(ordered.map((c) => c.name)).toEqual([
      "Aethelred Wallet",
      "MetaMask",
      "Example Wallet",
    ]);
  });

  it("hides the generic injected fallback when named wallets were discovered", () => {
    const ordered = orderWalletConnectors([generic, metamask, aethelred]);
    expect(ordered.map((c) => c.id)).toEqual([
      AETHELRED_WALLET_RDNS,
      METAMASK_RDNS,
    ]);
  });

  it("keeps the generic injected fallback when discovery found nothing", () => {
    const ordered = orderWalletConnectors([generic]);
    expect(ordered).toEqual([generic]);
  });

  it("keeps the injected fallback when only configured transports are present", () => {
    // walletConnect / coinbaseWalletSDK are configured connectors, not
    // EIP-6963 discoveries — they must not hide the injected fallback.
    const walletConnect = { id: "walletConnect", name: "WalletConnect" };
    const coinbase = { id: "coinbaseWalletSDK", name: "Coinbase Wallet" };
    const ordered = orderWalletConnectors([generic, walletConnect, coinbase]);
    expect(ordered.map((c) => c.name)).toEqual([
      "WalletConnect",
      "Coinbase Wallet",
      "Injected",
    ]);
  });

  it("ranks MetaMask by name when the rdns id is absent", () => {
    const legacyMetaMask = { id: "some.custom.build", name: "MetaMask Flask" };
    const ordered = orderWalletConnectors([other, legacyMetaMask, aethelred]);
    expect(ordered.map((c) => c.name)).toEqual([
      "Aethelred Wallet",
      "MetaMask Flask",
      "Example Wallet",
    ]);
  });

  it("preserves discovery order among unranked wallets", () => {
    const otherB = { id: "com.example.b", name: "B Wallet" };
    const ordered = orderWalletConnectors([other, otherB]);
    expect(ordered.map((c) => c.name)).toEqual(["Example Wallet", "B Wallet"]);
  });

  it("treats connectors without ids as named wallets, not fallbacks", () => {
    // Test harnesses (and some connector shims) omit `id`; they must
    // neither trigger the generic-injected hiding nor be hidden.
    const anonymous = { name: "Browser Wallet" };
    const ordered = orderWalletConnectors([generic, anonymous]);
    expect(ordered.map((c) => c.name)).toEqual(["Browser Wallet", "Injected"]);
  });
});

describe("isAethelredWallet", () => {
  it("matches only the org.aethelred.wallet rdns", () => {
    expect(
      isAethelredWallet({
        id: AETHELRED_WALLET_RDNS,
        name: "Aethelred Wallet",
      }),
    ).toBe(true);
    expect(isAethelredWallet({ id: METAMASK_RDNS, name: "MetaMask" })).toBe(
      false,
    );
    expect(isAethelredWallet({ name: "Aethelred Wallet" })).toBe(false);
  });
});
