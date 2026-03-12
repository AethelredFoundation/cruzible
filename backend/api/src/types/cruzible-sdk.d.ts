declare module '../../../../sdk/typescript/dist/src' {
  export function bytesToHex(value: Uint8Array): string;
  export function computeEligibleUniverseHash(addresses: string[]): Uint8Array;
  export function computeStakeSnapshotHash(
    epoch: bigint | number | string,
    stakers: ReadonlyArray<{
      address: string;
      shares: bigint | number | string;
      delegated_to: string;
    }>
  ): Uint8Array;
  export function computeStakerRegistryRoot(
    stakers: ReadonlyArray<{
      address: string;
      shares: bigint | number | string;
      delegated_to: string;
    }>
  ): Uint8Array;
  export function computeDelegationRegistryRoot(
    stakers: ReadonlyArray<{
      address: string;
      shares: bigint | number | string;
      delegated_to: string;
    }>
  ): Uint8Array;
  export function computeCanonicalDelegationPayload(input: {
    epoch: bigint | number | string;
    delegation_root: string;
    staker_registry_root: string;
  }): Uint8Array;
}
