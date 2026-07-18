import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateReleaseEvmDeployment } from "../../scripts/validate-release-evm-deployment.mjs";
import { buildEvmDeploymentManifest } from "../../scripts/lib/evm-deployment-manifest.mjs";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const cruzible = address("1");
const stAethel = address("2");
const deployer = address("3");
const genesisHash = hash("a");
const temporaryDirectories: string[] = [];

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Hex(value: string) {
  return sha256(Buffer.from(value.replace(/^0x/u, ""), "hex"));
}

function write(root: string, path: string, value: string) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, value);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cruzible-release-deployment-"));
  temporaryDirectories.push(root);
  const artifacts = {
    Cruzible: { abi: "[]\n", creation: "6000\n", runtime: "0x6002" },
    StAETHEL: { abi: "[]\n", creation: "6001\n", runtime: "0x6003" },
  };
  for (const [name, artifact] of Object.entries(artifacts)) {
    write(root, `backend/contracts-evm/artifacts/${name}.abi`, artifact.abi);
    write(
      root,
      `backend/contracts-evm/artifacts/${name}.bin`,
      artifact.creation,
    );
  }

  const contractEvidence = (
    name: keyof typeof artifacts,
    contractAddress: string,
    txDigit: string,
  ) => ({
    address: contractAddress,
    deployTxHash: hash(txDigit),
    blockNumber: "12",
    gasUsed: "345000",
    hashes: {
      abiFileSha256: sha256(Buffer.from(artifacts[name].abi)),
      creationBytecodeFileSha256: sha256(Buffer.from(artifacts[name].creation)),
      creationBytecodeSha256: sha256Hex(artifacts[name].creation.trim()),
      runtimeBytecodeSha256: sha256Hex(artifacts[name].runtime),
    },
  });

  const manifest = buildEvmDeploymentManifest({
    environment: "testnet",
    deployedAt: "2026-07-18T00:00:00.000Z",
    sourceCommit: "b".repeat(40),
    sourceClean: true,
    chainId: 7332,
    rpcUrl: "https://rpc.example.org/path",
    genesisBlockHash: genesisHash,
    headBlockNumber: 99n,
    headBlockHash: hash("b"),
    deployer,
    contracts: {
      Cruzible: contractEvidence("Cruzible", cruzible, "1"),
      StAETHEL: contractEvidence("StAETHEL", stAethel, "2"),
    },
    configurationTransactions: {
      setStAethel: {
        txHash: hash("3"),
        blockNumber: "13",
        gasUsed: "120000",
      },
    },
    roles: {
      currentGovernance: deployer,
      pendingGovernance: null,
      rewarder: deployer,
      pauser: deployer,
    },
    governanceHandover: { accepted: true, acceptanceRequired: false },
    unbondingPeriodSeconds: 3600,
  });

  const addressWord = (value: string) => `0x${"0".repeat(24)}${value.slice(2)}`;
  const responses = new Map<string, unknown>([
    ["eth_chainId", "0x1ca4"],
    ["eth_getBlockByNumber:0x1", { number: "0x1", hash: genesisHash }],
    [`eth_getTransactionByHash:${hash("1")}`, { input: "0x600000", to: null }],
    [
      `eth_getTransactionReceipt:${hash("1")}`,
      { contractAddress: cruzible, status: "0x1", blockNumber: "0xc" },
    ],
    [
      `eth_getTransactionByHash:${hash("2")}`,
      {
        input: `0x6001${"0".repeat(24)}${cruzible.slice(2)}`,
        to: null,
      },
    ],
    [
      `eth_getTransactionReceipt:${hash("2")}`,
      { contractAddress: stAethel, status: "0x1", blockNumber: "0xc" },
    ],
    [
      `eth_getTransactionByHash:${hash("3")}`,
      {
        input: `0x381f5775${"0".repeat(24)}${stAethel.slice(2)}`,
        to: cruzible,
      },
    ],
    [
      `eth_getTransactionReceipt:${hash("3")}`,
      { status: "0x1", blockNumber: "0xd" },
    ],
    [`eth_getCode:${cruzible}`, artifacts.Cruzible.runtime],
    [`eth_getCode:${stAethel}`, artifacts.StAETHEL.runtime],
    [`eth_call:${cruzible}`, addressWord(stAethel)],
    [`eth_call:${stAethel}`, addressWord(cruzible)],
  ]);
  const rpcCalls: Array<{ method: string; params: unknown[] }> = [];
  const rpc = async ({
    method,
    params,
  }: {
    method: string;
    params: unknown[];
  }) => {
    rpcCalls.push({ method, params });
    const discriminator =
      method === "eth_getTransactionByHash" ||
      method === "eth_getTransactionReceipt"
        ? String(params[0])
        : method === "eth_getBlockByNumber"
          ? String(params[0])
          : method === "eth_getCode"
            ? String(params[0]).toLowerCase()
            : method === "eth_call"
              ? String((params[0] as { to: string }).to).toLowerCase()
              : undefined;
    return responses.get(discriminator ? `${method}:${discriminator}` : method);
  };

  return { root, manifest, responses, rpc, rpcCalls };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("frontend release EVM deployment binding", () => {
  it("accepts current creation artifacts, live runtime, receipts, and two-way wiring", async () => {
    const { root, manifest, rpc, rpcCalls } = fixture();
    await expect(
      validateReleaseEvmDeployment({
        manifest,
        environment: "testnet",
        chainId: 7332,
        rpcUrl: "https://rpc.example.org/path",
        cruzibleAddress: cruzible,
        stAethelAddress: stAethel,
        expectedGenesisHash: genesisHash,
        repoRoot: root,
        rpc,
      }),
    ).resolves.toMatchObject({ chainId: 7332 });
    expect(rpcCalls).toContainEqual({
      method: "eth_getBlockByNumber",
      params: ["0x1", false],
    });
  });

  it("rejects an RPC that aliases the canonical query to the wrong block number", async () => {
    const { root, manifest, responses, rpc } = fixture();
    responses.set("eth_getBlockByNumber:0x1", {
      number: "0x0",
      hash: genesisHash,
    });

    await expect(
      validateReleaseEvmDeployment({
        manifest,
        environment: "testnet",
        chainId: 7332,
        rpcUrl: "https://rpc.example.org/path",
        cruzibleAddress: cruzible,
        stAethelAddress: stAethel,
        expectedGenesisHash: genesisHash,
        repoRoot: root,
        rpc,
      }),
    ).rejects.toThrow("anchor block 1");
  });

  it("rejects a deployment produced from stale contract artifacts", async () => {
    const { root, manifest, rpc } = fixture();
    manifest.contracts.Cruzible.hashes.creationBytecodeSha256 = "f".repeat(64);

    await expect(
      validateReleaseEvmDeployment({
        manifest,
        environment: "testnet",
        chainId: 7332,
        rpcUrl: "https://rpc.example.org/path",
        cruzibleAddress: cruzible,
        stAethelAddress: stAethel,
        expectedGenesisHash: genesisHash,
        repoRoot: root,
        rpc,
      }),
    ).rejects.toThrow("current committed creationBytecodeSha256 artifact");
  });

  it("rejects runtime drift at the configured release address", async () => {
    const { root, manifest, responses, rpc } = fixture();
    responses.set(`eth_getCode:${cruzible}`, "0x6004");

    await expect(
      validateReleaseEvmDeployment({
        manifest,
        environment: "testnet",
        chainId: 7332,
        rpcUrl: "https://rpc.example.org/path",
        cruzibleAddress: cruzible,
        stAethelAddress: stAethel,
        expectedGenesisHash: genesisHash,
        repoRoot: root,
        rpc,
      }),
    ).rejects.toThrow("live runtime bytecode");
  });

  it("rejects a frontend address that is not the evidenced deployment", async () => {
    const { root, manifest, rpc } = fixture();
    await expect(
      validateReleaseEvmDeployment({
        manifest,
        environment: "testnet",
        chainId: 7332,
        rpcUrl: "https://rpc.example.org/path",
        cruzibleAddress: address("9"),
        stAethelAddress: stAethel,
        expectedGenesisHash: genesisHash,
        repoRoot: root,
        rpc,
      }),
    ).rejects.toThrow("manifest address does not match the frontend release");
  });
});
