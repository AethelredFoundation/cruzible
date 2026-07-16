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
//
// 7332 is the CONFIRMED live Aethelred EVM chain id — the EIP-155 id baked
// into aethelredd's in-state chain config (`eth_chainId` returns 0x1ca4).
// Testnet and devnet are the SAME chain (7332) reached via different endpoints
// (a hosted RPC vs a local `aethelredd start --json-rpc.enable` node); they
// deliberately share the id. Mainnet keeps a distinct placeholder id until a
// production network actually exists.

export const AETHELRED_MAINNET_ID = 7331;
export const AETHELRED_TESTNET_ID = 7332;
export const AETHELRED_DEVNET_ID = 7332;

// Next.js inlines ONLY literal `process.env.NEXT_PUBLIC_*` reads into the
// browser bundle — a dynamic `process.env[name]` lookup compiles to an empty
// shim client-side, silently discarding the operator's override. Read the
// overrides as literals here and pass the values through.
const TESTNET_RPC_OVERRIDE = process.env.NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL;
const DEVNET_RPC_OVERRIDE = process.env.NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL;

/**
 * Resolve an RPC endpoint with an optional env override, so an operator can
 * point Cruzible at their own aethelredd node without editing source.
 *
 * IMPORTANT: the override MUST be passed in as a literal
 * `process.env.NEXT_PUBLIC_*` expression at the CALL SITE. Next.js inlines
 * client env vars only for literal property reads — a dynamic
 * `process.env[name]` lookup compiles to `undefined` in the browser bundle,
 * which silently disabled every RPC override here no matter what the
 * operator set, leaving the never-deployed fallback domains. Same root
 * cause as the ZeroID chains.ts fix.
 */
function rpcEndpoint(override: string | undefined, fallback: string): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

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
      http: [
        rpcEndpoint(
          TESTNET_RPC_OVERRIDE,
          "https://evm-rpc-testnet.aethelred.network",
        ),
      ],
    },
    public: {
      http: [
        rpcEndpoint(
          TESTNET_RPC_OVERRIDE,
          "https://evm-rpc-testnet.aethelred.network",
        ),
      ],
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
    // Defaults to a local `aethelredd start --json-rpc.enable` node (which
    // returns chain id 7332); override with the env var for a remote node.
    default: {
      http: [rpcEndpoint(DEVNET_RPC_OVERRIDE, "http://127.0.0.1:8545")],
    },
    public: {
      http: [rpcEndpoint(DEVNET_RPC_OVERRIDE, "http://127.0.0.1:8545")],
    },
  },
  testnet: true,
});

// ---------------------------------------------------------------------------
// Active Chain Selection
// ---------------------------------------------------------------------------

export type AethelredChainEnv = "mainnet" | "testnet" | "devnet";

const DEFAULT_NON_PRODUCTION_CHAIN_ENV: AethelredChainEnv = "testnet";
const SUPPORTED_CHAIN_ENVS = new Set<AethelredChainEnv>([
  "mainnet",
  "testnet",
  "devnet",
]);

function resolveChainEnv(): AethelredChainEnv {
  const rawChainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV?.trim();

  if (!rawChainEnv) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXT_PUBLIC_CHAIN_ENV is required in production");
    }

    return DEFAULT_NON_PRODUCTION_CHAIN_ENV;
  }

  if (!SUPPORTED_CHAIN_ENVS.has(rawChainEnv as AethelredChainEnv)) {
    throw new Error(
      "NEXT_PUBLIC_CHAIN_ENV must be one of mainnet, testnet, or devnet",
    );
  }

  return rawChainEnv as AethelredChainEnv;
}

export const CHAIN_ENV = resolveChainEnv();

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
