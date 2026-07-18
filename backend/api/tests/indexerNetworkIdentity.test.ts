import { describe, expect, it } from "vitest";
import { buildIndexerNetworkKeys } from "../src/lib/indexerNetworkIdentity";

const baseIdentity = {
  chainId: "7332",
  anchorHash: "0x" + "aa".repeat(32),
  vaultAddress: "0x1111111111111111111111111111111111111111",
};

describe("indexer network identity keys", () => {
  it("isolates same-chain-id networks by immutable anchor", () => {
    const testnet = buildIndexerNetworkKeys(baseIdentity);
    const devnet = buildIndexerNetworkKeys({
      ...baseIdentity,
      anchorHash: "0x" + "bb".repeat(32),
    });

    expect(devnet.cursorKey).not.toBe(testnet.cursorKey);
    expect(devnet.syncStateKey).not.toBe(testnet.syncStateKey);
    expect(devnet.cacheNamespace).not.toBe(testnet.cacheNamespace);
  });

  it("isolates vault deployments and normalizes hex casing", () => {
    const normalized = buildIndexerNetworkKeys({
      ...baseIdentity,
      anchorHash: baseIdentity.anchorHash.toUpperCase().replace("0X", "0x"),
      vaultAddress: baseIdentity.vaultAddress.toUpperCase().replace("0X", "0x"),
    });
    const otherVault = buildIndexerNetworkKeys({
      ...baseIdentity,
      vaultAddress: "0x2222222222222222222222222222222222222222",
    });

    expect(normalized).toEqual(buildIndexerNetworkKeys(baseIdentity));
    expect(otherVault.cursorKey).not.toBe(normalized.cursorKey);
  });

  it("isolates every indexed contract source", () => {
    const original = buildIndexerNetworkKeys({
      ...baseIdentity,
      staethelAddress: "0x2222222222222222222222222222222222222222",
      stablecoinBridgeAddress: "0x3333333333333333333333333333333333333333",
    });
    const changedShareToken = buildIndexerNetworkKeys({
      ...baseIdentity,
      staethelAddress: "0x4444444444444444444444444444444444444444",
      stablecoinBridgeAddress: "0x3333333333333333333333333333333333333333",
    });
    const changedBridge = buildIndexerNetworkKeys({
      ...baseIdentity,
      staethelAddress: "0x2222222222222222222222222222222222222222",
      stablecoinBridgeAddress: "0x5555555555555555555555555555555555555555",
    });

    expect(changedShareToken.cursorKey).not.toBe(original.cursorKey);
    expect(changedBridge.cursorKey).not.toBe(original.cursorKey);
    expect(changedShareToken.syncStateKey).not.toBe(original.syncStateKey);
    expect(changedBridge.cacheNamespace).not.toBe(original.cacheNamespace);
  });
});
