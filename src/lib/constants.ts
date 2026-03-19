// ============================================================
// AethelVault Shared Constants
// Brand colors, chart palettes, stablecoin registry, and common data
// ============================================================

import { keccak256, toHex } from "viem";

/** Brand color palette */
export const BRAND = {
  NAME: "Cruzible by Aethelred",
  red: "#DC2626",
  redDark: "#B91C1C",
  redLight: "#FEE2E2",
  redGlow: "rgba(220, 38, 38, 0.15)",
} as const;

/** Chart color palette for multi-series visualizations */
export const CHART_COLORS = [
  "#DC2626",
  "#F87171",
  "#FCA5A5",
  "#FECACA",
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
  "#F59E0B",
  "#EC4899",
  "#06B6D4",
] as const;

/** Validator / block producer names used across the app */
export const PRODUCER_NAMES = [
  "Aethelred Foundation",
  "Paradigm Stake",
  "Coinbase Cloud",
  "Figment",
  "Chorus One",
  "Blockdaemon",
  "Kiln Finance",
  "Staked.us",
  "P2P Validator",
  "Everstake",
  "HashQuark",
  "InfStones",
] as const;

/** Status color mappings for transaction/proposal statuses */
export const STATUS_STYLES = {
  Success: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  Verified: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  Completed: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  Active: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  Voting: {
    bg: "bg-blue-500/20",
    text: "text-blue-400",
    border: "border-blue-500/30",
    dot: "bg-blue-400",
  },
  Failed: {
    bg: "bg-red-500/20",
    text: "text-red-400",
    border: "border-red-500/30",
    dot: "bg-red-400",
  },
  Rejected: {
    bg: "bg-red-500/20",
    text: "text-red-400",
    border: "border-red-500/30",
    dot: "bg-red-400",
  },
  Pending: {
    bg: "bg-amber-500/20",
    text: "text-amber-400",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
  },
  Processing: {
    bg: "bg-amber-500/20",
    text: "text-amber-400",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
  },
  Queued: {
    bg: "bg-purple-500/20",
    text: "text-purple-400",
    border: "border-purple-500/30",
    dot: "bg-purple-400",
  },
  Executed: {
    bg: "bg-cyan-500/20",
    text: "text-cyan-400",
    border: "border-cyan-500/30",
    dot: "bg-cyan-400",
  },
} as const;

// ============================================================
// Stablecoin Asset Registry
// Phase-gated metadata for supported stablecoins.
// Phase 1: USDC (ACTIVE), USDT (READ_ONLY)
// ============================================================

/** Controls which operations are available for a stablecoin */
export enum StablecoinPhase {
  /** Full bridge operations (bridge-out, balance, history) */
  ACTIVE = "ACTIVE",
  /** Balance visible, bridge operations disabled */
  READ_ONLY = "READ_ONLY",
  /** Listed in UI but greyed out, no data */
  COMING_SOON = "COMING_SOON",
}

/** On-chain routing type from InstitutionalStablecoinBridge.RoutingType */
export enum StablecoinRoutingType {
  Unsupported = 0,
  CCTP_V2 = 1,
  TEE_ISSUER_MINT = 2,
}

/** Typed metadata for a stablecoin asset */
export interface StablecoinAsset {
  /** Token symbol (e.g. 'USDC') */
  symbol: string;
  /** Human-readable name */
  name: string;
  /** Token decimals (6 for USDC/USDT) */
  decimals: number;
  /** On-chain bytes32 asset ID: keccak256 of the symbol string */
  assetId: `0x${string}`;
  /** Bridge routing type */
  routingType: StablecoinRoutingType;
  /** Current launch phase */
  phase: StablecoinPhase;
  /** Path to token logo SVG */
  logoPath: string;
}

/**
 * Compute the on-chain `bytes32` asset ID for a given symbol.
 * Matches InstitutionalStablecoinBridge's keccak256(abi.encodePacked(symbol)) convention.
 */
export function getAssetId(symbol: string): `0x${string}` {
  return keccak256(toHex(symbol));
}

/** Check whether bridge operations are available for an asset */
export function isStablecoinEnabled(asset: StablecoinAsset): boolean {
  return asset.phase === StablecoinPhase.ACTIVE;
}

/**
 * Static registry of supported stablecoins.
 *
 * Token addresses are resolved at runtime from CONTRACT_ADDRESSES in chains.ts
 * to keep this module free of environment coupling.
 */
export const STABLECOIN_ASSETS: Record<string, StablecoinAsset> = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    assetId: getAssetId("USDC"),
    routingType: StablecoinRoutingType.CCTP_V2,
    phase: StablecoinPhase.ACTIVE,
    logoPath: "/tokens/usdc.svg",
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    assetId: getAssetId("USDT"),
    routingType: StablecoinRoutingType.CCTP_V2,
    phase: StablecoinPhase.READ_ONLY,
    logoPath: "/tokens/usdt.svg",
  },
} as const;

/** Returns only stablecoins with phase === ACTIVE */
export function getEnabledStablecoins(): StablecoinAsset[] {
  return Object.values(STABLECOIN_ASSETS).filter(isStablecoinEnabled);
}

/** Returns all registered stablecoins regardless of phase */
export function getAllStablecoins(): StablecoinAsset[] {
  return Object.values(STABLECOIN_ASSETS);
}

/** CCTP destination domain constants */
export const CCTP_DOMAINS = {
  ETHEREUM: 0,
  AVALANCHE: 1,
  OPTIMISM: 2,
  ARBITRUM: 3,
  BASE: 6,
  POLYGON: 7,
} as const;

export type CCTPDomainName = keyof typeof CCTP_DOMAINS;
