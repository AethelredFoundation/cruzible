import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateEvmContractArtifacts } from "../../scripts/validate-evm-contract-artifacts.mjs";

const contracts = ["Cruzible", "StAETHEL", "WstAETHEL"];

function write(root: string, path: string, value: string) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value);
}

function withArtifacts(
  mutate: (root: string) => void,
  run: (root: string) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "cruzible-evm-artifacts-"));

  try {
    for (const contract of contracts) {
      write(
        root,
        `backend/contracts-evm/out/${contract}.sol/${contract}.json`,
        JSON.stringify({
          abi: [{ type: "constructor", inputs: [] }],
          bytecode: { object: "0x60006000" },
          deployedBytecode: { object: "0x60016001" },
        }),
      );
      write(
        root,
        `backend/contracts-evm/artifacts/${contract}.abi`,
        JSON.stringify([{ inputs: [], type: "constructor" }]),
      );
      write(
        root,
        `backend/contracts-evm/artifacts/${contract}.bin`,
        "60006000\n",
      );
      write(
        root,
        `backend/contracts-evm/artifacts/${contract}.bin-runtime`,
        "60016001\n",
      );
    }

    mutate(root);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("EVM deployment artifact validation", () => {
  it("accepts committed ABIs and bytecode reproduced by Foundry", () => {
    withArtifacts(
      () => undefined,
      (root) => {
        expect(validateEvmContractArtifacts(root).errors).toEqual([]);
      },
    );
  });

  it("rejects stale committed deployment bytecode", () => {
    withArtifacts(
      (root) => {
        write(
          root,
          "backend/contracts-evm/artifacts/WstAETHEL.bin",
          "60016000\n",
        );
      },
      (root) => {
        expect(validateEvmContractArtifacts(root).errors).toContain(
          "committed bytecode for WstAETHEL does not match the current source; rebuild backend/contracts-evm/artifacts",
        );
      },
    );
  });

  it("rejects stale committed runtime bytecode", () => {
    withArtifacts(
      (root) => {
        write(
          root,
          "backend/contracts-evm/artifacts/StAETHEL.bin-runtime",
          "60026001\n",
        );
      },
      (root) => {
        expect(validateEvmContractArtifacts(root).errors).toContain(
          "committed runtime bytecode for StAETHEL does not match the current source; rebuild backend/contracts-evm/artifacts",
        );
      },
    );
  });

  it("rejects stale committed deployment ABIs", () => {
    withArtifacts(
      (root) => {
        write(root, "backend/contracts-evm/artifacts/Cruzible.abi", "[]\n");
      },
      (root) => {
        expect(validateEvmContractArtifacts(root).errors).toContain(
          "committed ABI for Cruzible does not match the current source; rebuild backend/contracts-evm/artifacts",
        );
      },
    );
  });
});
