import { describe, expect, it, vi } from "vitest";
import {
  assertWalletNetworkIdentity,
  NETWORK_ANCHOR_BLOCK_TAG,
} from "@/lib/networkGenesis";

const genesis = `0x${"a".repeat(64)}`;

function provider(chainId = "0x1ca4", genesisHash = genesis) {
  return {
    request: vi.fn(async ({ method }: { method: string }) =>
      method === "eth_chainId"
        ? chainId
        : { hash: genesisHash, number: NETWORK_ANCHOR_BLOCK_TAG },
    ),
  };
}

describe("wallet network genesis guard", () => {
  it("accepts only when wallet and simulation RPC match chain ID and genesis", async () => {
    const walletProvider = provider();
    const configuredProvider = provider();
    await expect(
      assertWalletNetworkIdentity({
        walletProvider,
        configuredProvider,
        expectedChainId: 7332,
        expectedGenesisHash: genesis,
      }),
    ).resolves.toBeUndefined();
    expect(walletProvider.request).toHaveBeenCalledWith({
      method: "eth_getBlockByNumber",
      params: [NETWORK_ANCHOR_BLOCK_TAG, false],
    });
    expect(configuredProvider.request).toHaveBeenCalledWith({
      method: "eth_getBlockByNumber",
      params: ["0x1", false],
    });
  });

  it("rejects a wallet on another genesis even when the chain ID is identical", async () => {
    await expect(
      assertWalletNetworkIdentity({
        walletProvider: provider("0x1ca4", `0x${"b".repeat(64)}`),
        configuredProvider: provider(),
        expectedChainId: 7332,
        expectedGenesisHash: genesis,
      }),
    ).rejects.toThrow("Chain ID alone is insufficient");
  });

  it("rejects a configured simulation RPC that drifted to another genesis", async () => {
    await expect(
      assertWalletNetworkIdentity({
        walletProvider: provider(),
        configuredProvider: provider("0x1ca4", `0x${"c".repeat(64)}`),
        expectedChainId: 7332,
        expectedGenesisHash: genesis,
      }),
    ).rejects.toThrow("exact Aethelred network");
  });

  it("rejects an RPC that aliases the block-1 request to another height", async () => {
    const aliased = {
      request: vi.fn(
        async ({ method }: { method: string }): Promise<unknown> =>
          method === "eth_chainId"
            ? "0x1ca4"
            : { hash: genesis, number: "0x0" },
      ),
    };

    await expect(
      assertWalletNetworkIdentity({
        walletProvider: aliased,
        configuredProvider: provider(),
        expectedChainId: 7332,
        expectedGenesisHash: genesis,
      }),
    ).rejects.toThrow("canonical block-1 anchor");
  });
});
