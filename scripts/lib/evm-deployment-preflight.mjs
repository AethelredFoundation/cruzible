export const ZEROID_REGISTRY_PROBE_ABI = [
  {
    type: "function",
    name: "resolveByController",
    stateMutability: "view",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [{ name: "didHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "isActiveIdentity",
    stateMutability: "view",
    inputs: [{ name: "didHash", type: "bytes32" }],
    outputs: [{ name: "active", type: "bool" }],
  },
];

export async function assertZeroIdRegistryInterface({
  publicClient,
  registry,
  controller,
}) {
  const code = await publicClient.getBytecode({ address: registry });
  if (!code || /^0x0*$/u.test(code)) {
    throw new Error(
      "ZEROID_REGISTRY has no runtime bytecode on the connected chain",
    );
  }

  let didHash;
  let active;
  try {
    didHash = await publicClient.readContract({
      address: registry,
      abi: ZEROID_REGISTRY_PROBE_ABI,
      functionName: "resolveByController",
      args: [controller],
    });
    active = await publicClient.readContract({
      address: registry,
      abi: ZEROID_REGISTRY_PROBE_ABI,
      functionName: "isActiveIdentity",
      args: [didHash],
    });
  } catch (error) {
    throw new Error(
      `ZEROID_REGISTRY does not implement the required resolveByController/isActiveIdentity view interface: ${error.shortMessage ?? error.message ?? String(error)}`,
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/u.test(didHash) || typeof active !== "boolean") {
    throw new Error(
      "ZEROID_REGISTRY returned invalid resolveByController/isActiveIdentity values",
    );
  }
  return { didHash, active };
}
