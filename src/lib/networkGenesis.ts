type Eip1193Requester = {
  request(args: {
    method: string;
    params?: readonly unknown[];
  }): Promise<unknown>;
};

type RpcBlock = { hash?: string | null; number?: string | null } | null;
export const NETWORK_ANCHOR_BLOCK_TAG = "0x1" as const;

function normalizeAnchorHash(value: unknown, label: string): string {
  const block = value as RpcBlock;
  const hash = block?.hash;
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(hash)) {
    throw new Error(`${label} did not return a valid block-1 anchor hash.`);
  }
  if (block?.number?.toLowerCase() !== NETWORK_ANCHOR_BLOCK_TAG) {
    throw new Error(`${label} did not return the canonical block-1 anchor.`);
  }
  return hash.toLowerCase();
}

function parseChainId(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/u.test(value)) {
    throw new Error(`${label} did not return a valid chain ID.`);
  }
  const parsed = Number(BigInt(value));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} returned an unsupported chain ID.`);
  }
  return parsed;
}

export async function assertWalletNetworkIdentity({
  walletProvider,
  configuredProvider,
  expectedChainId,
  expectedGenesisHash,
}: {
  walletProvider: Eip1193Requester;
  configuredProvider: Eip1193Requester;
  expectedChainId: number;
  expectedGenesisHash: string;
}): Promise<void> {
  const expectedGenesis = expectedGenesisHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(expectedGenesis)) {
    throw new Error("The configured expected genesis hash is invalid.");
  }

  const [walletChainId, configuredChainId, walletGenesis, configuredGenesis] =
    await Promise.all([
      walletProvider.request({ method: "eth_chainId" }),
      configuredProvider.request({ method: "eth_chainId" }),
      walletProvider.request({
        method: "eth_getBlockByNumber",
        params: [NETWORK_ANCHOR_BLOCK_TAG, false],
      }),
      configuredProvider.request({
        method: "eth_getBlockByNumber",
        params: [NETWORK_ANCHOR_BLOCK_TAG, false],
      }),
    ]);

  if (
    parseChainId(walletChainId, "Wallet provider") !== expectedChainId ||
    parseChainId(configuredChainId, "Configured RPC") !== expectedChainId
  ) {
    throw new Error(
      "Wallet or configured RPC chain ID does not match this release.",
    );
  }
  if (
    normalizeAnchorHash(walletGenesis, "Wallet provider") !== expectedGenesis ||
    normalizeAnchorHash(configuredGenesis, "Configured RPC") !== expectedGenesis
  ) {
    throw new Error(
      "Wallet and configured RPC are not on the exact Aethelred network selected by this release. Chain ID alone is insufficient.",
    );
  }
}
