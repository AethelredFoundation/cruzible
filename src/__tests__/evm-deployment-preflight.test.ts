import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertZeroIdRegistryInterface } from "../../scripts/lib/evm-deployment-preflight.mjs";

const registry = "0x1111111111111111111111111111111111111111";
const controller = "0x2222222222222222222222222222222222222222";
const didHash = `0x${"a".repeat(64)}`;

describe("EVM deployment preflight", () => {
  it("rebuilds and rejects artifact/source drift before a release broadcast", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts", "deploy-contracts.mjs"),
      "utf8",
    );
    const releasePreflight = source.indexOf(
      'if (process.env.RELEASE_DEPLOYMENT === "1")',
    );
    const deployment = source.indexOf("console.log(`== deploy");

    expect(releasePreflight).toBeGreaterThan(-1);
    expect(source.slice(releasePreflight, deployment)).toContain(
      'execFileSync(\n      "forge",',
    );
    expect(source.slice(releasePreflight, deployment)).toContain(
      "validateEvmContractArtifacts(repoRoot)",
    );
  });

  it("probes both required ZeroID registry views before enabling the gate", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(didHash)
      .mockResolvedValueOnce(false);
    const publicClient = {
      getBytecode: vi.fn().mockResolvedValue("0x6000"),
      readContract,
    };

    await expect(
      assertZeroIdRegistryInterface({ publicClient, registry, controller }),
    ).resolves.toEqual({ didHash, active: false });
    expect(readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: registry,
        functionName: "resolveByController",
        args: [controller],
      }),
    );
    expect(readContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        address: registry,
        functionName: "isActiveIdentity",
        args: [didHash],
      }),
    );
  });

  it("rejects bytecode that does not implement the ZeroID interface", async () => {
    const publicClient = {
      getBytecode: vi.fn().mockResolvedValue("0x6000"),
      readContract: vi.fn().mockRejectedValue(new Error("decode failed")),
    };

    await expect(
      assertZeroIdRegistryInterface({ publicClient, registry, controller }),
    ).rejects.toThrow("does not implement the required");
  });

  it("rejects an address without runtime bytecode", async () => {
    const publicClient = {
      getBytecode: vi.fn().mockResolvedValue("0x"),
      readContract: vi.fn(),
    };

    await expect(
      assertZeroIdRegistryInterface({ publicClient, registry, controller }),
    ).rejects.toThrow("has no runtime bytecode");
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });
});
