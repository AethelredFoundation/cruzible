#!/usr/bin/env node
/**
 * Cruzible × ZeroID — IDENTITY-GATED STAKING, live devnet proof.
 *
 * The three-way integration (Aethelred Wallet ↔ Cruzible ↔ ZeroID) lands on
 * chain here: the REAL ZeroID.sol identity registry (from the zeroid repo,
 * not a mock) is deployed next to the vault, Cruzible's identity gate is
 * pointed at it, and the full lifecycle is proven live:
 *
 *   1. an unregistered wallet CANNOT stake (IdentityGateClosed)
 *   2. the wallet registers its identity in ZeroID (permissionless,
 *      controller-bound) → the SAME stake now succeeds
 *   3. ZeroID governance SUSPENDS the identity → the next stake is blocked
 *      immediately (the check is live, never cached)
 *   4. exits are NEVER identity-gated: the suspended wallet still unstakes
 *      and withdraws in full
 *
 * Env: RPC_URL (default http://127.0.0.1:8547)
 *      DEPLOYER_KEY   funded; deploys everything, plays ZeroID governance
 *      STAKER_KEY     funded; plays the end user (registers + stakes)
 *      ZEROID_ARTIFACT path to the zeroid repo's Foundry artifact, e.g.
 *                      <zeroid>/foundry-out/ZeroID.sol/ZeroID.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  formatEther,
  http,
  keccak256,
  parseEther,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(
  __dirname,
  "..",
  "backend",
  "contracts-evm",
  "artifacts",
);
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8547";

const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};
const step = (m) => console.log(`\n== ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headroom = (est, floor) => (est * 2n > floor ? est * 2n : floor);

for (const k of ["DEPLOYER_KEY", "STAKER_KEY", "ZEROID_ARTIFACT"]) {
  if (!process.env[k]) fail(`${k} required`);
}

const loadLocal = (name) => ({
  abi: JSON.parse(readFileSync(join(artifactsDir, `${name}.abi`), "utf8")),
  bytecode: `0x${readFileSync(join(artifactsDir, `${name}.bin`), "utf8").trim()}`,
});
// The REAL ZeroID registry, straight from the zeroid repo's Foundry build.
const zeroIdArtifact = JSON.parse(
  readFileSync(process.env.ZEROID_ARTIFACT, "utf8"),
);
const zeroId = {
  abi: zeroIdArtifact.abi,
  bytecode: zeroIdArtifact.bytecode.object,
};

const chain = defineChain({
  id: 7332,
  name: "Aethelred Devnet",
  nativeCurrency: { name: "AETHEL", symbol: "AETHEL", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const admin = privateKeyToAccount(process.env.DEPLOYER_KEY);
const staker = privateKeyToAccount(process.env.STAKER_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const clients = {
  [admin.address]: createWalletClient({
    account: admin,
    chain,
    transport: http(RPC_URL),
  }),
  [staker.address]: createWalletClient({
    account: staker,
    chain,
    transport: http(RPC_URL),
  }),
};

async function deploy(as, { abi, bytecode }, args, label) {
  const gas = headroom(
    await publicClient.estimateGas({
      account: as,
      data: encodeDeployData({ abi, bytecode, args }),
    }),
    8_000_000n,
  );
  const hash = await clients[as.address].deployContract({
    abi,
    bytecode,
    args,
    gas,
  });
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (r.status !== "success") fail(`${label} deploy reverted`);
  console.log(`${label} @ ${r.contractAddress}`);
  return { address: r.contractAddress, abi };
}

async function write(as, c, fn, args = [], value = 0n) {
  const gas = headroom(
    await publicClient.estimateContractGas({
      address: c.address,
      abi: c.abi,
      functionName: fn,
      args,
      value,
      account: as,
    }),
    800_000n,
  );
  const hash = await clients[as.address].writeContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
    value,
    gas,
  });
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 60_000,
  });
  if (r.status !== "success") fail(`${fn} reverted`);
  return r;
}

/** Assert a write REVERTS at simulation, with the given marker in the error. */
async function expectRevert(as, c, fn, args, value, marker, what) {
  try {
    await publicClient.simulateContract({
      address: c.address,
      abi: c.abi,
      functionName: fn,
      args,
      value,
      account: as.address,
    });
  } catch (e) {
    const msg = `${e.shortMessage ?? ""} ${e.message ?? ""}`;
    if (marker && !msg.includes(marker))
      fail(`${what}: reverted but not with ${marker}: ${msg.slice(0, 200)}`);
    console.log(`${what} ✓ (reverted${marker ? `: ${marker}` : ""})`);
    return;
  }
  fail(`${what}: expected revert, but the call would succeed`);
}

const read = (c, fn, args = []) =>
  publicClient.readContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
  });

async function main() {
  step("chain identity");
  const chainId = await publicClient.getChainId();
  if (chainId !== 7332) fail(`chain id ${chainId}, want 7332`);
  console.log(
    `eth_chainId: ${chainId}  admin: ${admin.address}  staker: ${staker.address}`,
  );

  step("deploy the REAL ZeroID identity registry + the Cruzible suite");
  const registry = await deploy(admin, zeroId, [admin.address], "ZeroID");
  const vault = await deploy(
    admin,
    loadLocal("Cruzible"),
    [admin.address, admin.address, admin.address, 30n],
    "Cruzible",
  );
  const token = await deploy(
    admin,
    loadLocal("StAETHEL"),
    [vault.address],
    "StAETHEL",
  );
  await write(admin, vault, "setStAethel", [token.address]);
  await write(admin, vault, "setIdentityGate", [registry.address, true]);
  console.log("identity gate ON, pointed at the live ZeroID registry");

  // ── 1. No identity → no entry ─────────────────────────────────────────────
  step("unregistered wallet cannot stake");
  if (await read(vault, "isIdentityVerified", [staker.address]))
    fail("fresh wallet must not be verified");
  await expectRevert(
    staker,
    vault,
    "stake",
    [],
    parseEther("3"),
    "IdentityGateClosed",
    "stake without identity",
  );

  // ── 2. Register in ZeroID → the same stake succeeds ──────────────────────
  step("staker registers a ZeroID identity (permissionless, controller-bound)");
  const didHash = keccak256(
    toHex(`did:zeroid:e2e:${staker.address.toLowerCase()}`),
  );
  await write(staker, registry, "registerIdentity", [
    didHash,
    keccak256(toHex("recovery")),
  ]);
  if (
    (await read(registry, "resolveByController", [staker.address])) !== didHash
  )
    fail("registry did not bind the controller");
  if (!(await read(vault, "isIdentityVerified", [staker.address])))
    fail("vault must see the active identity");
  console.log(
    `identity ${didHash.slice(0, 18)}… bound to staker ✓  vault sees it ✓`,
  );

  await write(staker, vault, "stake", [], parseEther("3"));
  const stBal = await read(token, "balanceOf", [staker.address]);
  if (stBal < parseEther("2.999"))
    fail(`stAETHEL not minted (${formatEther(stBal)})`);
  console.log(`stake admitted: ${formatEther(stBal)} stAETHEL minted ✓`);

  // ── 3. Suspension blocks NEW stakes immediately (live check, no cache) ───
  step("ZeroID governance suspends the identity");
  await write(admin, registry, "updateIdentityStatus", [didHash, 2]); // Suspended
  if (await read(vault, "isIdentityVerified", [staker.address]))
    fail("vault must see the suspension immediately");
  await expectRevert(
    staker,
    vault,
    "stake",
    [],
    parseEther("1"),
    "IdentityGateClosed",
    "stake while suspended",
  );

  // ── 4. Exits are NEVER identity-gated ─────────────────────────────────────
  step("suspended wallet can still exit in full");
  const shares = await read(token, "sharesOf", [staker.address]);
  await write(staker, vault, "unstake", [shares]);
  const withdrawals = await read(vault, "getUserWithdrawals", [staker.address]);
  const wid = withdrawals[withdrawals.length - 1].id;
  await sleep(32_000); // vault unbonding period (30s)
  const before = await publicClient.getBalance({ address: staker.address });
  await write(staker, vault, "withdraw", [wid]);
  const got =
    (await publicClient.getBalance({ address: staker.address })) - before;
  if (got < parseEther("2.99"))
    fail(`exit not paid in full (${formatEther(got)})`);
  console.log(
    `withdrawn +${formatEther(got)} AETHEL (net of gas) while suspended ✓`,
  );

  step("summary");
  console.log("IDENTITY-GATED STAKING LIVE ON AETHELRED:");
  console.log(
    "  · Cruzible admission verified against the REAL ZeroID registry",
  );
  console.log("  · no identity → no entry; register once → stake normally");
  console.log(
    "  · suspension/revocation in ZeroID blocks new stakes instantly",
  );
  console.log(
    "  · exits are never identity-gated — funds are always retrievable",
  );
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));
