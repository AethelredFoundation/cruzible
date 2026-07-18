import { describe, expect, it } from "vitest";
import {
  buildEvmDeploymentManifest,
  publicRpcOrigin,
  validateEvmDeploymentManifest,
} from "../../scripts/lib/evm-deployment-manifest.mjs";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const sha = (digit: string) => digit.repeat(64);

function contract(digit: string) {
  return {
    address: address(digit),
    deployTxHash: hash(digit),
    blockNumber: "12",
    gasUsed: "345000",
    hashes: {
      abiFileSha256: sha("a"),
      creationBytecodeFileSha256: sha("b"),
      creationBytecodeSha256: sha("c"),
      runtimeBytecodeSha256: sha("d"),
    },
  };
}

const input = {
  environment: "testnet",
  deployedAt: "2026-07-18T00:00:00.000Z",
  sourceCommit: "a".repeat(40),
  sourceClean: true,
  chainId: 7332,
  rpcUrl: "https://user:secret@rpc.example.org/project/key?token=secret",
  genesisBlockHash: hash("1"),
  headBlockNumber: 99n,
  headBlockHash: hash("2"),
  deployer: address("1"),
  contracts: {
    Cruzible: contract("1"),
    StAETHEL: contract("2"),
    WstAETHEL: contract("3"),
  },
  configurationTransactions: {
    setStAethel: {
      txHash: hash("4"),
      blockNumber: "13",
      gasUsed: "120000",
    },
  },
  roles: {
    currentGovernance: address("1"),
    pendingGovernance: address("4"),
    rewarder: address("2"),
    pauser: address("3"),
  },
  governanceHandover: { accepted: false, acceptanceRequired: true },
  unbondingPeriodSeconds: 3600,
};

describe("EVM deployment manifest", () => {
  it("records release evidence without leaking RPC credentials or paths", () => {
    const manifest = buildEvmDeploymentManifest(input);

    expect(manifest.chain.rpcOrigin).toBe("https://rpc.example.org");
    expect(manifest.schema).toBe("cruzible.evm_deployment_manifest.v2");
    expect(manifest.chain.genesisBlockNumber).toBe(1);
    expect(JSON.stringify(manifest)).not.toContain("secret");
    expect(validateEvmDeploymentManifest(manifest).errors).toEqual([]);
  });

  it("rejects ambiguous or non-canonical EVM genesis anchors", () => {
    const manifest = buildEvmDeploymentManifest(input);
    manifest.chain.genesisBlockNumber = 0;

    expect(validateEvmDeploymentManifest(manifest).errors).toContain(
      "$.chain.genesisBlockNumber must be 1",
    );
  });

  it("rejects missing transaction and runtime-code evidence", () => {
    const manifest = buildEvmDeploymentManifest(input);
    delete manifest.contracts.Cruzible.deployTxHash;
    delete manifest.contracts.Cruzible.hashes.runtimeBytecodeSha256;

    expect(validateEvmDeploymentManifest(manifest).errors.join("\n")).toContain(
      "$.contracts.Cruzible.deployTxHash",
    );
    expect(validateEvmDeploymentManifest(manifest).errors.join("\n")).toContain(
      "$.contracts.Cruzible.hashes.runtimeBytecodeSha256 is required",
    );
  });

  it("redacts an authenticated RPC URL to its public origin", () => {
    expect(publicRpcOrigin("https://name:password@rpc.example.org/a?x=1")).toBe(
      "https://rpc.example.org",
    );
  });
});
