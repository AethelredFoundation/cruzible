/**
 * Aethelred Chain Configuration
 *
 * Defines the Aethelred L1 chain for wagmi/viem integration.
 * Supports mainnet, testnet, and local development environments.
 */

import { defineChain } from "viem";

// ---------------------------------------------------------------------------
// Chain IDs
// ---------------------------------------------------------------------------

export const AETHELRED_MAINNET_ID = 7331;
export const AETHELRED_TESTNET_ID = 7332;
export const AETHELRED_DEVNET_ID = 7333;

// ---------------------------------------------------------------------------
// Chain Definitions
// ---------------------------------------------------------------------------

export const aethelredMainnet = defineChain({
  id: AETHELRED_MAINNET_ID,
  name: "Aethelred",
  nativeCurrency: {
    name: "AETHEL",
    symbol: "AETHEL",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://evm-rpc.aethelred.network"],
      webSocket: ["wss://evm-ws.aethelred.network"],
    },
    public: {
      http: ["https://evm-rpc.aethelred.network"],
      webSocket: ["wss://evm-ws.aethelred.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Aethelred Explorer",
      url: "https://explorer.aethelred.network",
    },
  },
  contracts: {
    // Cruzible vault proxy address (populated after deployment)
    // multicall3 address if deployed
  },
});

export const aethelredTestnet = defineChain({
  id: AETHELRED_TESTNET_ID,
  name: "Aethelred Testnet",
  nativeCurrency: {
    name: "AETHEL",
    symbol: "AETHEL",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://evm-rpc-testnet.aethelred.network"],
      webSocket: ["wss://evm-ws-testnet.aethelred.network"],
    },
    public: {
      http: ["https://evm-rpc-testnet.aethelred.network"],
      webSocket: ["wss://evm-ws-testnet.aethelred.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Aethelred Testnet Explorer",
      url: "https://explorer-testnet.aethelred.network",
    },
  },
  testnet: true,
});

export const aethelredDevnet = defineChain({
  id: AETHELRED_DEVNET_ID,
  name: "Aethelred Devnet",
  nativeCurrency: {
    name: "AETHEL",
    symbol: "AETHEL",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["http://localhost:8545"],
      webSocket: ["ws://localhost:8546"],
    },
    public: {
      http: ["http://localhost:8545"],
      webSocket: ["ws://localhost:8546"],
    },
  },
  testnet: true,
});

// ---------------------------------------------------------------------------
// Active Chain Selection
// ---------------------------------------------------------------------------

const CHAIN_ENV = process.env.NEXT_PUBLIC_CHAIN_ENV || "testnet";

export const activeChain =
  CHAIN_ENV === "mainnet"
    ? aethelredMainnet
    : CHAIN_ENV === "devnet"
      ? aethelredDevnet
      : aethelredTestnet;

export const supportedChains = [
  aethelredMainnet,
  aethelredTestnet,
  aethelredDevnet,
] as const;

// ---------------------------------------------------------------------------
// Contract Addresses (populated per-environment)
// ---------------------------------------------------------------------------

export const CONTRACT_ADDRESSES = {
  cruzible: process.env.NEXT_PUBLIC_CRUZIBLE_ADDRESS || "",
  stAethel: process.env.NEXT_PUBLIC_STAETHEL_ADDRESS || "",
  aethelToken: process.env.NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS || "",
  governance: process.env.NEXT_PUBLIC_GOVERNANCE_ADDRESS || "",
  // Stablecoin bridge & token addresses
  stablecoinBridge: process.env.NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS || "",
  usdcToken: process.env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS || "",
  usdtToken: process.env.NEXT_PUBLIC_USDT_TOKEN_ADDRESS || "",
} as const;

/**
 * Maps stablecoin symbols to their token address keys in CONTRACT_ADDRESSES.
 * Used by AppContext and hooks to look up the correct address at runtime.
 */
export const STABLECOIN_TOKEN_ADDRESS_KEYS: Record<
  string,
  keyof typeof CONTRACT_ADDRESSES
> = {
  USDC: "usdcToken",
  USDT: "usdtToken",
};
