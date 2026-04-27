import { getAddress, isAddress, zeroAddress, type Address } from "viem";

import { CONTRACT_ADDRESSES, STABLECOIN_TOKEN_ADDRESS_KEYS } from "./chains";

export type ContractAddressKey = keyof typeof CONTRACT_ADDRESSES;

export function normalizeContractAddress(
  value: string | undefined,
): Address | undefined {
  if (!value || !isAddress(value) || getAddress(value) === zeroAddress) {
    return undefined;
  }

  return getAddress(value);
}

export function getContractAddress(
  key: ContractAddressKey,
): Address | undefined {
  return normalizeContractAddress(CONTRACT_ADDRESSES[key]);
}

export function getStablecoinTokenAddress(symbol: string): Address | undefined {
  const key = STABLECOIN_TOKEN_ADDRESS_KEYS[symbol];
  return key ? getContractAddress(key) : undefined;
}
