import {
  getContractAddress,
  getStablecoinTokenAddress,
} from "@/config/contracts";
import { getEnabledStablecoins } from "@/lib/constants";

/**
 * The public bridge surface is exposed only when at least one promoted asset
 * has both a token address and the bridge contract configured. A source-chain
 * burn alone is not proof that destination settlement is operational.
 */
export function isStablecoinBridgeAvailable(): boolean {
  if (!getContractAddress("stablecoinBridge")) return false;

  return getEnabledStablecoins().some((asset) =>
    Boolean(getStablecoinTokenAddress(asset.symbol)),
  );
}
