import { formatUnits } from "viem";
import { apiJson } from "@/lib/api-request";
import type { StablecoinAsset } from "@/lib/constants";

export interface StablecoinBridgeEvent {
  id: string;
  assetId: string;
  eventType: string;
  sender: string;
  amount: string;
  destDomain: number | null;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  timestamp: string;
}

interface StablecoinBridgeHistoryResponse {
  data: StablecoinBridgeEvent[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export type StablecoinBridgeHistoryRow = StablecoinBridgeEvent & {
  symbol: string;
  decimals: number;
};

function trimFormattedUnits(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function formatStablecoinAmount(
  amount: string,
  decimals: number,
): string {
  try {
    return trimFormattedUnits(formatUnits(BigInt(amount), decimals));
  } catch {
    return "unavailable";
  }
}

export function shortStablecoinHash(value: string): string {
  return value.length > 14
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}

export async function fetchStablecoinBridgeHistory(
  assets: StablecoinAsset[],
): Promise<StablecoinBridgeHistoryRow[]> {
  const histories = await Promise.all(
    assets.map(async (asset) => {
      const payload = await apiJson<StablecoinBridgeHistoryResponse>(
        `/stablecoins/${asset.assetId}/history?limit=25`,
        {
          fallbackMessage: `Failed to load ${asset.symbol} bridge history`,
        },
      );

      return payload.data.map((event) => ({
        ...event,
        symbol: asset.symbol,
        decimals: asset.decimals,
      }));
    }),
  );

  return histories
    .flat()
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() -
        new Date(left.timestamp).getTime(),
    )
    .slice(0, 25);
}
