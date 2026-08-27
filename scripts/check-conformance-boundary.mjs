#!/usr/bin/env node
/**
 * §6.1 conformance-boundary guard.
 *
 * Cruzible reaches the Aethelred protocol for transport (viem RPC + contract
 * calls) and verifies Digital Seals through the on-chain ISeal precompile
 * (0x0900) — never a parallel, hand-rolled verifier or crypto stack. That is
 * the property the launch checklist requires ("no parallel chain client,
 * verifier, or crypto"). It holds today; this guard keeps it from regressing.
 *
 * It FAILS the build if any src/ file (tests excluded) does something only a
 * parallel verifier/crypto implementation would:
 *   - imports a ZK/snark proving or verifying library
 *   - imports a low-level EC-crypto library for signature recovery
 *   - defines its own seal/proof verification function
 *
 * viem / ethers / @cosmjs are ALLOWED — they are transport, not verification.
 *
 * Roll out to the other dApps by copying this file + the package.json script.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/** Patterns that indicate a parallel verifier / crypto implementation. */
const FORBIDDEN = [
  {
    re: /from\s+['"](snarkjs|circomlibjs|@zk-kit\/|ffjavascript)['"]/,
    why: "ZK proving/verifying library — verification must go through the canonical protocol, not a bundled prover",
  },
  {
    re: /from\s+['"](elliptic|@noble\/secp256k1|@noble\/curves\/secp256k1|secp256k1)['"]/,
    why: "low-level EC crypto — signature recovery/verification must not be re-implemented in the dApp",
  },
  {
    re: /function\s+verify(Seal|Proof|Groth16|Attestation)\b/,
    why: "parallel seal/proof/attestation verifier — verify through the ISeal precompile / canonical SDK",
  },
  {
    re: /\bnew\s+Groth16Verifier\b/,
    why: "bundled Groth16 verifier — use the chain's verification precompile",
  },
];

/** Files intentionally exempt (none today; kept for future documented waivers). */
const EXEMPT = new Set([]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      out.push(...walk(p));
    } else if (
      CODE_EXT.has(extname(name)) &&
      !/\.(test|spec)\.[tj]sx?$/.test(name)
    ) {
      out.push(p);
    }
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const rel = file.slice(ROOT.length);
  if (EXEMPT.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  for (const { re, why } of FORBIDDEN) {
    const m = text.match(re);
    if (m) violations.push({ rel, match: m[0], why });
  }
}

if (violations.length > 0) {
  console.error(
    "✗ conformance-boundary guard: parallel verifier/crypto detected\n",
  );
  for (const v of violations) {
    console.error(
      `  ${v.rel}\n    matched: ${v.match}\n    reason:  ${v.why}\n`,
    );
  }
  console.error(
    "Route canonical capabilities (seal/proof verification, crypto) through",
  );
  console.error(
    "the on-chain precompile / canonical SDK, not a bundled implementation.",
  );
  process.exit(1);
}

console.log(
  "✓ conformance-boundary guard: no parallel verifier/crypto in src/",
);
