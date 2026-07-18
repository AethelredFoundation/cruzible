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
// (an operator-supplied RPC vs a local `aethelredd start --json-rpc.enable`
// node); they deliberately share the id. Mainnet has no repository default:
// its id and endpoints must be supplied only after that network is confirmed.

export const AETHELRED_TESTNET_ID = 7332;
export const AETHELRED_DEVNET_ID = 7332;

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

// Next.js inlines ONLY literal `process.env.NEXT_PUBLIC_*` reads into the
// browser bundle — a dynamic `process.env[name]` lookup compiles to an empty
// shim client-side, silently discarding the operator's override. Read the
// overrides as literals here and pass the values through.
const MAINNET_CHAIN_ID_OVERRIDE =
  process.env.NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID;
const MAINNET_RPC_OVERRIDE = process.env.NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL;
const MAINNET_EXPLORER_OVERRIDE =
  process.env.NEXT_PUBLIC_AETHELRED_MAINNET_EXPLORER_URL;
const TESTNET_RPC_OVERRIDE = process.env.NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL;
const TESTNET_EXPLORER_OVERRIDE =
  process.env.NEXT_PUBLIC_AETHELRED_TESTNET_EXPLORER_URL;
const DEVNET_RPC_OVERRIDE = process.env.NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL;
const GENESIS_HASH_OVERRIDE =
  process.env.NEXT_PUBLIC_AETHELRED_GENESIS_HASH?.trim();

if (process.env.NODE_ENV === "production" && !GENESIS_HASH_OVERRIDE) {
  throw new Error(
    "NEXT_PUBLIC_AETHELRED_GENESIS_HASH is required in production to distinguish networks that share a chain id",
  );
}

export const ACTIVE_GENESIS_HASH = GENESIS_HASH_OVERRIDE;

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

function optionalPositiveInteger(
  value: string | undefined,
): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      "NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID must be a positive integer",
    );
  }

  return parsed;
}

const configuredMainnetId = optionalPositiveInteger(MAINNET_CHAIN_ID_OVERRIDE);
const configuredMainnetRpc = MAINNET_RPC_OVERRIDE?.trim() || undefined;
const configuredMainnetExplorer =
  MAINNET_EXPLORER_OVERRIDE?.trim() || undefined;
const hasCompleteMainnetConfig = Boolean(
  configuredMainnetId && configuredMainnetRpc && configuredMainnetExplorer,
);

if (CHAIN_ENV === "mainnet" && !hasCompleteMainnetConfig) {
  throw new Error(
    "mainnet is not a repository default; NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID, NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL, and NEXT_PUBLIC_AETHELRED_MAINNET_EXPLORER_URL are required",
  );
}

if (
  CHAIN_ENV === "testnet" &&
  process.env.NODE_ENV === "production" &&
  !TESTNET_RPC_OVERRIDE?.trim()
) {
  throw new Error(
    "NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL is required for production testnet builds",
  );
}

export const AETHELRED_MAINNET_ID = configuredMainnetId;

// ---------------------------------------------------------------------------
// Chain Definitions
// ---------------------------------------------------------------------------

export const aethelredMainnet = hasCompleteMainnetConfig
  ? defineChain({
      id: configuredMainnetId!,
      name: "Aethelred Mainnet",
      nativeCurrency: {
        name: "AETHEL",
        symbol: "AETHEL",
        decimals: 18,
      },
      rpcUrls: {
        default: { http: [configuredMainnetRpc!] },
        public: { http: [configuredMainnetRpc!] },
      },
      blockExplorers: {
        default: {
          name: "Aethelred Mainnet Explorer",
          url: configuredMainnetExplorer!,
        },
      },
    })
  : undefined;

const testnetRpc = rpcEndpoint(TESTNET_RPC_OVERRIDE, "http://127.0.0.1:8545");

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
      http: [testnetRpc],
    },
    public: {
      http: [testnetRpc],
    },
  },
  ...(TESTNET_EXPLORER_OVERRIDE?.trim()
    ? {
        blockExplorers: {
          default: {
            name: "Aethelred Testnet Explorer",
            url: TESTNET_EXPLORER_OVERRIDE.trim(),
          },
        },
      }
    : {}),
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

export const activeChain =
  CHAIN_ENV === "mainnet"
    ? aethelredMainnet!
    : CHAIN_ENV === "devnet"
      ? aethelredDevnet
      : aethelredTestnet;

export const supportedChains = [
  ...(aethelredMainnet ? [aethelredMainnet] : []),
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
