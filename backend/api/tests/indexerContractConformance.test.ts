/**
 * Indexer ↔ contract conformance.
 *
 * The indexer's event ABI determines topic hashes; if it drifts from the
 * deployed contract, the indexer silently misses every event (verified live
 * 2026-07-14: an earlier ABI described a different contract line and indexed
 * nothing). The materialization tests cannot catch that class of bug — they
 * encode synthetic logs with the indexer's own ABI, so they only prove
 * self-consistency. This suite pins the indexer's signatures to the actual
 * Solidity source of the vault.
 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Interface } from "ethers";
import { describe, expect, it } from "vitest";

import { CRUZIBLE_VAULT_ABI } from "../src/services/IndexerService";

const CONTRACT_PATH = join(__dirname, "../../contracts-evm/src/Cruzible.sol");

/** Canonical `Name(type,type,...)` signatures parsed from the .sol source. */
function contractEventSignatures(source: string): Map<string, string> {
  const signatures = new Map<string, string>();
  // Matches single- and multi-line event declarations up to the closing ');'
  const eventRe = /event\s+(\w+)\s*\(([^;]*?)\)\s*;/gs;
  for (const match of source.matchAll(eventRe)) {
    const name = match[1];
    const params = match[2]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map(
        (p) =>
          p
            .replace(/\bindexed\b/g, "")
            .trim()
            .split(/\s+/)[0],
      );
    signatures.set(name, `${name}(${params.join(",")})`);
  }
  return signatures;
}

describe("indexer vault ABI conforms to the deployed Cruzible.sol", () => {
  const source = readFileSync(CONTRACT_PATH, "utf8");
  const contractSigs = contractEventSignatures(source);
  const iface = new Interface(CRUZIBLE_VAULT_ABI);

  const consumedEvents = [
    "Staked",
    "Unstaked",
    "Withdrawn",
    "RewardsAdded",
    "RewardsClaimed",
  ];

  it.each(consumedEvents)(
    "topic hash for %s matches the contract source",
    (name) => {
      const contractSig = contractSigs.get(name);
      expect(
        contractSig,
        `event ${name} not found in Cruzible.sol — indexer consumes a nonexistent event`,
      ).toBeDefined();

      const indexerFragment = iface.getEvent(name);
      expect(
        indexerFragment,
        `indexer ABI has no event ${name}`,
      ).not.toBeNull();

      // Same canonical signature ⇒ same keccak topic hash.
      expect(indexerFragment!.format("sighash")).toBe(contractSig);
    },
  );

  it("indexer declares no vault events absent from the contract", () => {
    for (const fragment of iface.fragments) {
      if (fragment.type !== "event") continue;
      const name = (fragment as { name?: string }).name!;
      expect(
        contractSigs.has(name),
        `indexer ABI event ${name} does not exist in Cruzible.sol`,
      ).toBe(true);
    }
  });
});
