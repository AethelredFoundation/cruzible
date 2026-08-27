import { createHash } from "node:crypto";
import { config } from "../config";

export const LEGACY_INDEXER_CURSOR_KEY = "evm-indexer";

export type IndexerNetworkIdentity = {
  chainId: string;
  anchorHash: string;
  vaultAddress: string;
  staethelAddress: string;
  stablecoinBridgeAddress: string;
};

export type IndexerNetworkIdentityInput = Omit<
  IndexerNetworkIdentity,
  "staethelAddress" | "stablecoinBridgeAddress"
> &
  Partial<
    Pick<IndexerNetworkIdentity, "staethelAddress" | "stablecoinBridgeAddress">
  >;

export type IndexerNetworkKeys = {
  identity: IndexerNetworkIdentity;
  identityDigest: string;
  cursorKey: string;
  syncStateKey: string;
  cacheNamespace: string;
};

export function buildIndexerNetworkKeys(
  identity: IndexerNetworkIdentityInput,
): IndexerNetworkKeys {
  const normalizedIdentity = {
    chainId: identity.chainId.trim(),
    anchorHash: identity.anchorHash.trim().toLowerCase(),
    vaultAddress: identity.vaultAddress.trim().toLowerCase() || "no-vault",
    staethelAddress:
      identity.staethelAddress?.trim().toLowerCase() || "no-staethel",
    stablecoinBridgeAddress:
      identity.stablecoinBridgeAddress?.trim().toLowerCase() || "no-bridge",
  };
  const identityDigest = createHash("sha256")
    .update(
      [
        normalizedIdentity.chainId,
        normalizedIdentity.anchorHash,
        normalizedIdentity.vaultAddress,
        normalizedIdentity.staethelAddress,
        normalizedIdentity.stablecoinBridgeAddress,
      ].join(":"),
    )
    .digest("hex");

  return {
    identity: normalizedIdentity,
    identityDigest,
    cursorKey: `evm-indexer:${identityDigest}`,
    syncStateKey: `aethelred-evm:${identityDigest}`,
    cacheNamespace: `cruzible:${identityDigest}`,
  };
}

/**
 * Resolve the production-configured namespace for API/read-side consumers.
 * Non-production callers with incomplete network configuration retain the
 * legacy key; production validation requires the network, vault, and every
 * source address enabled by the deployment profile.
 */
export function getConfiguredIndexerNetworkKeys(): IndexerNetworkKeys | null {
  if (
    !config.indexerExpectedChainId ||
    !config.indexerExpectedGenesisHash ||
    !config.cruzibleVaultAddress
  ) {
    return null;
  }

  return buildIndexerNetworkKeys({
    chainId: config.indexerExpectedChainId,
    anchorHash: config.indexerExpectedGenesisHash,
    vaultAddress: config.cruzibleVaultAddress,
    staethelAddress: config.staethelAddress,
    stablecoinBridgeAddress: config.stablecoinBridgeAddress,
  });
}

export function getConfiguredIndexerCursorKey(): string {
  return (
    getConfiguredIndexerNetworkKeys()?.cursorKey ?? LEGACY_INDEXER_CURSOR_KEY
  );
}
