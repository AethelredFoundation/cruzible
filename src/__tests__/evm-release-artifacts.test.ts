import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareEvmReleaseArtifacts } from "../../scripts/prepare-evm-release-artifacts.mjs";

function write(root: string, path: string, contents: string) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

describe("canonical EVM release bundle", () => {
  it("pins source, configuration, source, tests, ABIs, bytecode, and checksums", () => {
    const root = mkdtempSync(join(tmpdir(), "cruzible-evm-release-"));
    const output = join(root, "backend", "contracts-evm", "release-artifacts");

    try {
      for (const contract of ["Cruzible", "StAETHEL", "WstAETHEL"]) {
        write(root, `backend/contracts-evm/artifacts/${contract}.abi`, "[]\n");
        write(
          root,
          `backend/contracts-evm/artifacts/${contract}.bin`,
          "6000\n",
        );
        write(
          root,
          `backend/contracts-evm/artifacts/${contract}.bin-runtime`,
          "6001\n",
        );
      }
      write(
        root,
        "backend/contracts-evm/src/Cruzible.sol",
        "contract Cruzible {}\n",
      );
      write(
        root,
        "backend/contracts-evm/test/Cruzible.t.sol",
        "contract CruzibleTest {}\n",
      );
      write(root, "backend/contracts-evm/foundry.toml", "[profile.default]\n");
      write(root, "backend/contracts-evm/build.sh", "#!/bin/sh\n");

      const { manifest } = prepareEvmReleaseArtifacts({
        repoRoot: root,
        outputDirectory: output,
        sourceSha: "a".repeat(40),
      });

      expect(manifest.schema).toBe("cruzible.evm_contract_release_bundle.v1");
      expect(manifest.source.git_commit).toBe("a".repeat(40));
      expect(manifest.files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "artifacts/Cruzible.abi",
          "artifacts/Cruzible.bin",
          "artifacts/Cruzible.bin-runtime",
          "src/Cruzible.sol",
          "test/Cruzible.t.sol",
          "foundry.toml",
        ]),
      );
      expect(existsSync(join(output, "SHA256SUMS"))).toBe(true);
      expect(readFileSync(join(output, "SHA256SUMS"), "utf8")).toContain(
        "manifest.json",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects destructive output targets outside the fixed contract release directory", () => {
    const root = mkdtempSync(join(tmpdir(), "cruzible-evm-release-target-"));
    try {
      for (const outputDirectory of [
        "/",
        join(root, ".."),
        join(root, "sibling"),
      ]) {
        expect(() =>
          prepareEvmReleaseArtifacts({
            repoRoot: root,
            outputDirectory,
            sourceSha: "a".repeat(40),
          }),
        ).toThrow("release output must be exactly");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked release directory before recursive cleanup", () => {
    const root = mkdtempSync(join(tmpdir(), "cruzible-evm-release-link-"));
    const outside = mkdtempSync(
      join(tmpdir(), "cruzible-evm-release-outside-"),
    );
    const output = join(root, "backend", "contracts-evm", "release-artifacts");
    try {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(join(outside, "must-survive"), "safe\n");
      symlinkSync(outside, output);

      expect(() =>
        prepareEvmReleaseArtifacts({
          repoRoot: root,
          sourceSha: "a".repeat(40),
        }),
      ).toThrow("release output must not be a symbolic link");
      expect(readFileSync(join(outside, "must-survive"), "utf8")).toBe(
        "safe\n",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
