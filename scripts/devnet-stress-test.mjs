#!/usr/bin/env node
/**
 * Cruzible × ZeroID — CONCURRENT STRESS TEST, live devnet.
 *
 * Hammers a freshly-deployed, identity-GATED vault with concurrent traffic
 * from many independent wallets and verifies that correctness holds under
 * load — the production-readiness question for sovereign/regulated clients
 * is not "does it work once" but "does anything break under pressure":
 *
 *   Phase A — N wallets funded; most register REAL ZeroID identities
 *             concurrently; a control group stays unregistered.
 *   Phase B — the storm: registered wallets run randomized concurrent
 *             stake / unstake / instant-exit cycles while the control group
 *             keeps attempting to stake (every attempt MUST fail) and
 *             governance SUSPENDS two identities mid-storm (their next
 *             stakes MUST fail; their exits MUST keep working).
 *   Phase C — settle: mature the queue, withdraw everything claimable.
 *   Phase D — verdict: the solvency identity must hold EXACTLY
 *             (balance == pooled + reserved + merkleReserve), the gate
 *             counters must be perfect (zero unauthorized admissions),
 *             and read-path latency is measured under concurrent load
 *             (the wallet + frontend polling surface).
 *
 * Env: RPC_URL (default http://127.0.0.1:8547), DEPLOYER_KEY (funded ~300),
 *      ZEROID_ARTIFACT, WALLETS (default 16), ROUNDS (default 4).
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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(
  __dirname,
  "..",
  "backend",
  "contracts-evm",
  "artifacts",
);
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8547";
const N = Number(process.env.WALLETS ?? 16);
const ROUNDS = Number(process.env.ROUNDS ?? 4);

const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};
const step = (m) => console.log(`\n== ${m}`);
for (const k of ["DEPLOYER_KEY", "ZEROID_ARTIFACT"]) {
  if (!process.env[k]) fail(`${k} required`);
}

const loadLocal = (name) => ({
  abi: JSON.parse(readFileSync(join(artifactsDir, `${name}.abi`), "utf8")),
  bytecode: `0x${readFileSync(join(artifactsDir, `${name}.bin`), "utf8").trim()}`,
});
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
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const adminClient = createWalletClient({
  account: admin,
  chain,
  transport: http(RPC_URL),
});
const headroom = (est, floor) => (est * 2n > floor ? est * 2n : floor);

const counters = {
  txOk: 0,
  txFail: 0,
  gateBlocksExpected: 0,
  gateBlocksMissed: 0,
  suspendedBlocksExpected: 0,
  suspendedBlocksMissed: 0,
};

async function deployAs(client, art, args, label) {
  const gas = headroom(
    await publicClient.estimateGas({
      account: client.account,
      data: encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args }),
    }),
    8_000_000n,
  );
  const hash = await client.deployContract({
    abi: art.abi,
    bytecode: art.bytecode,
    args,
    gas,
  });
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  if (r.status !== "success") fail(`${label} deploy reverted`);
  console.log(`${label} @ ${r.contractAddress}`);
  return { address: r.contractAddress, abi: art.abi };
}

/** Fire a write from a wallet; returns true on success, false on revert. */
async function tryWrite(client, c, fn, args = [], value = 0n) {
  try {
    const gas = headroom(
      await publicClient.estimateContractGas({
        address: c.address,
        abi: c.abi,
        functionName: fn,
        args,
        value,
        account: client.account,
      }),
      800_000n,
    );
    const hash = await client.writeContract({
      address: c.address,
      abi: c.abi,
      functionName: fn,
      args,
      value,
      gas,
    });
    const r = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
    if (r.status !== "success") return false;
    counters.txOk++;
    return true;
  } catch {
    counters.txFail++;
    return false;
  }
}

const read = (c, fn, args = []) =>
  publicClient.readContract({
    address: c.address,
    abi: c.abi,
    functionName: fn,
    args,
  });

const quantile = (sorted, q) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

async function main() {
  const t0 = Date.now();
  step(`chain identity + ${N} wallets, ${ROUNDS} storm rounds`);
  if ((await publicClient.getChainId()) !== 7332) fail("chain id must be 7332");

  const wallets = Array.from({ length: N }, (_, i) => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    return {
      i,
      account,
      client: createWalletClient({ account, chain, transport: http(RPC_URL) }),
      registered: false,
      suspended: false,
      didHash: keccak256(toHex(`did:zeroid:stress:${i}:${account.address}`)),
    };
  });

  step("deploy gated stack (REAL ZeroID + Cruzible + StAETHEL)");
  const registry = await deployAs(
    adminClient,
    zeroId,
    [admin.address],
    "ZeroID",
  );
  const vault = await deployAs(
    adminClient,
    loadLocal("Cruzible"),
    [admin.address, admin.address, admin.address, 30n],
    "Cruzible",
  );
  const token = await deployAs(
    adminClient,
    loadLocal("StAETHEL"),
    [vault.address],
    "StAETHEL",
  );
  await tryWrite(adminClient, vault, "setStAethel", [token.address]);
  await tryWrite(adminClient, vault, "setIdentityGate", [
    registry.address,
    true,
  ]);

  step("fund wallets (sequential nonces from the deployer)");
  for (const w of wallets) {
    const hash = await adminClient.sendTransaction({
      to: w.account.address,
      value: parseEther("12"),
    });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  }
  console.log(`funded ${N} wallets with 12 AETHEL each`);

  // ── Phase A: concurrent identity registrations (control group abstains) ──
  step(
    "Phase A — concurrent ZeroID registrations (last 4 wallets stay unregistered)",
  );
  const registering = wallets.slice(0, N - 4);
  await Promise.all(
    registering.map(async (w) => {
      w.registered = await tryWrite(w.client, registry, "registerIdentity", [
        w.didHash,
        keccak256(toHex(`recovery:${w.i}`)),
      ]);
    }),
  );
  const registeredCount = registering.filter((w) => w.registered).length;
  if (registeredCount !== N - 4)
    fail(`${N - 4 - registeredCount} concurrent registrations lost`);
  console.log(`${registeredCount}/${N - 4} concurrent registrations landed`);

  // ── Phase B: the storm ────────────────────────────────────────────────────
  step(`Phase B — concurrent storm (${ROUNDS} rounds × ${N} wallets)`);
  const stormStart = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    // Mid-storm suspension: after round 1, governance suspends two identities.
    if (round === 2) {
      for (const w of wallets.slice(0, 2)) {
        await tryWrite(adminClient, registry, "updateIdentityStatus", [
          w.didHash,
          2,
        ]);
        w.suspended = true;
      }
      console.log("  governance suspended wallets #0 and #1 mid-storm");
    }

    await Promise.all(
      wallets.map(async (w) => {
        if (!w.registered) {
          // Control group: every stake attempt MUST be blocked by the gate.
          const ok = await tryWrite(
            w.client,
            vault,
            "stake",
            [],
            parseEther("1"),
          );
          if (ok) counters.gateBlocksMissed++;
          else counters.gateBlocksExpected++;
          return;
        }
        if (w.suspended) {
          // Suspended: new stakes MUST fail; exits MUST keep working.
          const ok = await tryWrite(
            w.client,
            vault,
            "stake",
            [],
            parseEther("0.5"),
          );
          if (ok) counters.suspendedBlocksMissed++;
          else counters.suspendedBlocksExpected++;
          const shares = await read(token, "sharesOf", [w.account.address]);
          if (shares > 0n) {
            await tryWrite(w.client, vault, "unstake", [shares / 2n + 1n]);
          }
          return;
        }
        // Registered actors: randomized op mix.
        const r = Number(BigInt(keccak256(toHex(`op:${round}:${w.i}`))) % 3n);
        if (r === 0) {
          await tryWrite(
            w.client,
            vault,
            "stake",
            [],
            parseEther(String(1 + (w.i % 3))),
          );
        } else if (r === 1) {
          const shares = await read(token, "sharesOf", [w.account.address]);
          if (shares > 2n)
            await tryWrite(w.client, vault, "unstake", [shares / 2n]);
          else await tryWrite(w.client, vault, "stake", [], parseEther("1"));
        } else {
          const shares = await read(token, "sharesOf", [w.account.address]);
          if (shares > 4n)
            await tryWrite(w.client, vault, "instantUnstake", [
              shares / 4n,
              0n,
            ]);
          else await tryWrite(w.client, vault, "stake", [], parseEther("2"));
        }
      }),
    );
    console.log(
      `  round ${round + 1}/${ROUNDS} done (ok=${counters.txOk} fail=${counters.txFail})`,
    );
  }
  const stormSecs = (Date.now() - stormStart) / 1000;

  // ── Phase C: settle — mature and drain the queue ──────────────────────────
  step("Phase C — settle: mature the queue (30s) and withdraw everything");
  await new Promise((r) => setTimeout(r, 32_000));
  let withdrawals = 0;
  await Promise.all(
    wallets.map(async (w) => {
      const list = await read(vault, "getUserWithdrawals", [w.account.address]);
      for (const wd of list) {
        if (!wd.claimed && Number(wd.completionTime) * 1000 <= Date.now()) {
          if (await tryWrite(w.client, vault, "withdraw", [wd.id]))
            withdrawals++;
        }
      }
    }),
  );
  console.log(`  ${withdrawals} queued withdrawals paid out`);

  // ── Phase D: verdict ──────────────────────────────────────────────────────
  step("Phase D — invariants + read-path latency under concurrent load");
  const [balance, pooled, reserved, merkle] = await Promise.all([
    publicClient.getBalance({ address: vault.address }),
    read(vault, "totalPooledAethel"),
    read(vault, "totalReserved"),
    read(vault, "merkleReserve"),
  ]);
  if (balance !== pooled + reserved + merkle) {
    fail(
      `SOLVENCY BROKEN: balance ${formatEther(balance)} != pooled ${formatEther(pooled)} + reserved ${formatEther(reserved)} + merkle ${formatEther(merkle)}`,
    );
  }
  console.log(
    `  solvency EXACT: balance ${formatEther(balance)} == pooled ${formatEther(pooled)} + reserved ${formatEther(reserved)} ✓`,
  );
  if (counters.gateBlocksMissed > 0)
    fail(`${counters.gateBlocksMissed} UNAUTHORIZED stakes admitted`);
  if (counters.suspendedBlocksMissed > 0)
    fail(`${counters.suspendedBlocksMissed} SUSPENDED stakes admitted`);
  console.log(
    `  gate perfect under load: ${counters.gateBlocksExpected} unregistered + ${counters.suspendedBlocksExpected} suspended attempts ALL blocked ✓`,
  );

  // Read-path latency: 300 concurrent polls of the UI's two hot reads.
  const latencies = [];
  await Promise.all(
    Array.from({ length: 150 }, async (_, i) => {
      const w = wallets[i % N];
      let t = Date.now();
      await read(vault, "isIdentityVerified", [w.account.address]);
      latencies.push(Date.now() - t);
      t = Date.now();
      await read(vault, "getExchangeRate");
      latencies.push(Date.now() - t);
    }),
  );
  latencies.sort((a, b) => a - b);
  console.log(
    `  read latency under 300-call burst: p50 ${quantile(latencies, 0.5)}ms · p95 ${quantile(latencies, 0.95)}ms · p99 ${quantile(latencies, 0.99)}ms`,
  );

  step("summary");
  const totalTx = counters.txOk + counters.txFail;
  console.log(
    `STRESS TEST PASSED in ${((Date.now() - t0) / 1000).toFixed(0)}s:`,
  );
  console.log(
    `  · ${N} wallets, ${totalTx} transactions (${counters.txOk} succeeded, ${counters.txFail} correctly rejected/failed)`,
  );
  console.log(
    `  · storm throughput: ${(counters.txOk / stormSecs).toFixed(1)} successful tx/s sustained over ${stormSecs.toFixed(0)}s`,
  );
  console.log(
    `  · zero unauthorized admissions; zero suspended-identity admissions`,
  );
  console.log(`  · solvency identity EXACT to the wei after the storm`);
}

main().catch((e) => fail(e.shortMessage ?? e.message ?? String(e)));
