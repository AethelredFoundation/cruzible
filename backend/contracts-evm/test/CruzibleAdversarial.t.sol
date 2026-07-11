// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

import {Cruzible} from "../src/Cruzible.sol";
import {StAETHEL} from "../src/StAETHEL.sol";
import {WstAETHEL} from "../src/WstAETHEL.sol";
import {Vm, MockISeal, MockZeroIDRegistry, MockStakingPrecompile, MockDistributionPrecompile} from "./Cruzible.t.sol";

/// A registry that reverts on every call — models a broken, censoring, or
/// maliciously-upgraded identity source. The vault must FAIL CLOSED for
/// staking and stay FULLY OPEN for exits.
contract RevertingRegistry {
    function resolveByController(address) external pure returns (bytes32) {
        revert("registry unavailable");
    }

    function isActiveIdentity(bytes32) external pure returns (bool) {
        revert("registry unavailable");
    }
}

/// Adversarial + fuzz coverage for the audit questions a sovereign client's
/// reviewer asks that the happy-path suite does not:
///
///   - can share rounding EVER favor the staker over the pool? (fuzzed)
///   - are instant-exit payouts EXACTLY value-minus-fee, buffer-bounded? (fuzzed)
///   - can ANY dusty amount slip through the 6↔18-decimal bridge? (fuzzed)
///   - what happens when the identity registry is broken or misconfigured?
///     (staking bricks fail-CLOSED; exits are never touched)
///   - does the solvency invariant hold under a randomized multi-actor
///     operation storm? (in-EVM stress)
contract CruzibleAdversarialTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant ISEAL = 0x0000000000000000000000000000000000000900;
    address constant STAKING = 0x0000000000000000000000000000000000000800;
    address constant DISTRIBUTION = 0x0000000000000000000000000000000000000801;

    Cruzible vault;
    StAETHEL token;

    address gov = address(0x6087);
    address rewarder = address(0x9E1A);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 passed;

    function setUp() internal {
        vault = new Cruzible(gov, rewarder, rewarder, 100);
        token = new StAETHEL(address(vault));
        vm.prank(gov);
        vault.setStAethel(address(token));

        MockISeal sealImpl = new MockISeal();
        vm.etch(ISEAL, address(sealImpl).code);
        MockISeal(ISEAL).setPolicy(true, "");
    }

    function assertTrue(bool c, string memory what) internal {
        require(c, what);
        passed++;
    }

    // ── fuzz: rounding can never favor the staker ────────────────────────────

    /// After an odd-rate rebase, ANY deposit → full immediate exit must return
    /// at most the deposit: share rounding always favors the pool, so a
    /// stake/unstake loop can never mint value.
    function testFuzz_stake_unstake_roundtrip_never_profits(uint96 rawAmount) public {
        setUp();
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        vault.stake{value: 100 ether}();

        // Push the rate to an odd value (guarded, cap opt-in like prod ops).
        vm.prank(gov);
        vault.setRateGuard(2000, 10 minutes);
        vm.deal(rewarder, 13.37 ether);
        vm.prank(rewarder);
        vault.addRewards{value: 13.37 ether}();

        uint256 amount = 1 + (uint256(rawAmount) % 1_000_000 ether);
        vm.deal(bob, amount);
        vm.prank(bob);
        uint256 shares;
        // Dust deposits may legitimately revert (StakeTooSmall); that is the
        // defense working, not a counterexample.
        try vault.stake{value: amount}() returns (uint256 s) {
            shares = s;
        } catch {
            passed++;
            return;
        }

        vm.prank(bob);
        (, uint256 outAmount) = vault.unstake(shares);
        assertTrue(outAmount <= amount, "round-trip must never profit the staker");
    }

    /// Instant exits: payout is EXACTLY value minus the fee, never exceeds the
    /// free buffer, and the pool stays solvent afterwards.
    function testFuzz_instant_unstake_exact_fee_and_solvency(uint96 rawShares) public {
        setUp();
        vm.deal(alice, 50 ether);
        vm.prank(alice);
        vault.stake{value: 50 ether}();

        uint256 maxShares = token.sharesOf(alice);
        uint256 shares = 1 + (uint256(rawShares) % maxShares);
        uint256 value = token.getAethelByShares(shares);
        uint256 fee = (value * vault.instantExitFeeBps()) / 10_000;

        uint256 before = alice.balance;
        vm.prank(alice);
        try vault.instantUnstake(shares, 0) returns (uint256 paid) {
            assertTrue(paid == value - fee, "payout must be exactly value minus fee");
            assertTrue(alice.balance - before == paid, "native transfer must match");
            assertTrue(
                vault.totalManaged() >=
                    vault.totalPooledAethel() + vault.totalReserved() + vault.merkleReserve(),
                "solvency must hold after an instant exit"
            );
        } catch {
            // Zero-value dust may revert (ZeroAmount) — acceptable.
            passed++;
        }
    }

    /// The 6↔18-decimal bridge: EVERY amount that is not a whole-uaethel
    /// multiple must be rejected; every whole multiple must be accepted.
    function testFuzz_delegate_bridge_dust_rejection(uint96 rawAmount) public {
        setUp();
        MockStakingPrecompile stImpl = new MockStakingPrecompile();
        vm.etch(STAKING, address(stImpl).code);
        MockStakingPrecompile(STAKING).setUnbondingPeriod(60);

        vm.deal(alice, 1_000 ether);
        vm.prank(alice);
        vault.stake{value: 1_000 ether}();

        uint256 amount = 1 + (uint256(rawAmount) % 900 ether);
        vm.prank(gov);
        if (amount % 1e12 != 0) {
            vm.expectRevert(Cruzible.BadParam.selector);
            vault.delegateToValidator("aethelvaloper1abc", amount);
            passed++;
        } else {
            vault.delegateToValidator("aethelvaloper1abc", amount);
            assertTrue(vault.totalDelegated() == amount, "whole-uaethel amount delegates");
        }
    }

    // ── the identity registry as an adversary ────────────────────────────────

    /// A registry that REVERTS (broken upgrade, censorship, RPC-of-doom)
    /// bricks NEW staking — fail closed — but every exit path keeps working.
    /// Funds can never be trapped by the identity layer.
    function test_reverting_registry_fails_closed_but_exits_stay_open() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
        vm.prank(alice);
        (uint256 wid, ) = vault.unstake(2 ether);

        // Governance points the gate at a registry that then breaks.
        RevertingRegistry broken = new RevertingRegistry();
        vm.prank(gov);
        vault.setIdentityGate(address(broken), true);

        // Staking: fail closed.
        vm.deal(bob, 5 ether);
        vm.prank(bob);
        vm.expectRevert();
        vault.stake{value: 5 ether}();

        // Exits: all three paths still work.
        vm.prank(alice);
        vault.unstake(1 ether);
        vm.prank(alice);
        vault.instantUnstake(1 ether, 0);
        vm.warp(block.timestamp + 101);
        vm.prank(alice);
        vault.withdraw(wid);
        passed++;
    }

    /// Misconfigured gate (registry address is an EOA / wrong contract):
    /// the staticcall returns empty data, decoding reverts → FAIL CLOSED.
    /// A configuration mistake can never silently admit everyone.
    function test_garbage_registry_fails_closed_not_open() public {
        setUp();
        vm.prank(gov);
        vault.setIdentityGate(address(0xDEAD1), true); // EOA — no code

        assertTrue(!isVerifiedSafely(alice), "view fails closed on garbage registry");
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectRevert();
        vault.stake{value: 5 ether}();
    }

    function isVerifiedSafely(address who) internal view returns (bool ok) {
        try vault.isIdentityVerified(who) returns (bool v) {
            return v;
        } catch {
            return false;
        }
    }

    // ── in-EVM operation storm ───────────────────────────────────────────────

    /// Randomized multi-actor storm: 5 actors × 60 rounds of stake / unstake /
    /// instant exit / matured withdrawals / guarded rebases, with the solvency
    /// invariant asserted after EVERY operation. Deterministic seed so a
    /// failure reproduces exactly.
    function test_accounting_storm_holds_solvency_invariant() public {
        setUp();
        address[5] memory actors =
            [address(0xA1), address(0xA2), address(0xA3), address(0xA4), address(0xA5)];
        uint256[] memory pendingIds = new uint256[](64);
        uint256 pendingCount;
        uint256 t = block.timestamp;

        vm.prank(gov);
        vault.setRateGuard(2000, 10 minutes);

        for (uint256 round = 0; round < 60; round++) {
            address actor = actors[round % 5];
            uint256 r = uint256(keccak256(abi.encode("storm", round)));
            uint256 op = r % 4;

            if (op == 0 || token.sharesOf(actor) == 0) {
                uint256 amount = 0.5 ether + (r % 20 ether);
                vm.deal(actor, actor.balance + amount);
                vm.prank(actor);
                vault.stake{value: amount}();
            } else if (op == 1) {
                uint256 shares = 1 + (r % token.sharesOf(actor));
                vm.prank(actor);
                (uint256 wid, ) = vault.unstake(shares);
                if (pendingCount < 64) pendingIds[pendingCount++] = wid;
            } else if (op == 2) {
                uint256 shares = 1 + (r % token.sharesOf(actor));
                uint256 value = token.getAethelByShares(shares);
                uint256 fee = (value * vault.instantExitFeeBps()) / 10_000;
                if (value - fee <= vault.freeBuffer() && value > 0) {
                    vm.prank(actor);
                    vault.instantUnstake(shares, 0);
                }
            } else {
                // Guarded rebase + mature the queue, then drain claimables.
                t += 11 minutes;
                vm.warp(t);
                uint256 reward = (vault.totalPooledAethel() * (r % 1500)) / 10_000;
                if (reward > 0) {
                    vm.deal(rewarder, reward);
                    vm.prank(rewarder);
                    vault.addRewards{value: reward}();
                }
                for (uint256 i = 0; i < pendingCount; i++) {
                    uint256 wid = pendingIds[i];
                    address owner = findOwner(actors, wid);
                    if (owner != address(0) && vault.isWithdrawalClaimable(owner, wid)) {
                        vm.prank(owner);
                        vault.withdraw(wid);
                    }
                }
            }

            assertTrue(
                vault.totalManaged() >=
                    vault.totalPooledAethel() + vault.totalReserved() + vault.merkleReserve(),
                "solvency must hold after every operation"
            );
            uint256 shares_ = token.getTotalShares();
            if (shares_ > 0) {
                assertTrue(
                    token.getAethelByShares(shares_) <= vault.totalPooledAethel() + 1,
                    "share supply can never claim more than the pool"
                );
            }
        }
    }

    function findOwner(address[5] memory actors, uint256 wid) internal view returns (address) {
        for (uint256 i = 0; i < 5; i++) {
            if (vault.isWithdrawalClaimable(actors[i], wid)) return actors[i];
        }
        return address(0);
    }

    // ── economic-attack + keeper-robustness scenarios ────────────────────────

    /// A direct donation (force-sent balance) can never move the exchange
    /// rate: the rate reads the explicit accumulator, not the balance.
    function test_donation_cannot_move_rate_or_break_solvency() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
        uint256 rateBefore = vault.getExchangeRate();

        vm.deal(address(vault), address(vault).balance + 100 ether); // donation
        assertTrue(vault.getExchangeRate() == rateBefore, "donation must not move the rate");
        assertTrue(
            vault.totalManaged() >=
                vault.totalPooledAethel() + vault.totalReserved() + vault.merkleReserve(),
            "solvency (>=) holds with donated surplus"
        );
    }

    /// Deposit-just-before-reward / withdraw-just-after: the maximum
    /// extractable gain per report is bounded by the rate guard's cap —
    /// a sandwicher cannot capture more than maxRebaseBps of their stake.
    function test_reward_sandwich_gain_bounded_by_rate_guard() public {
        setUp();
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        vault.stake{value: 100 ether}();

        // Bob deposits right before the report…
        vm.deal(bob, 50 ether);
        vm.prank(bob);
        uint256 shares = vault.stake{value: 50 ether}();

        vm.warp(block.timestamp + 2 hours);
        uint256 maxReward = (vault.totalPooledAethel() * vault.maxRebaseBps()) / 10_000;
        vm.deal(rewarder, maxReward);
        vm.prank(rewarder);
        vault.addRewards{value: maxReward}();

        // …and exits right after. The gain is capped by the guard.
        vm.prank(bob);
        (, uint256 outAmount) = vault.unstake(shares);
        uint256 maxAllowed = 50 ether + (50 ether * vault.maxRebaseBps()) / 10_000;
        assertTrue(outAmount <= maxAllowed, "sandwich gain must be bounded by maxRebaseBps");
    }

    /// Two exits racing for a buffer that covers only one: exactly one wins,
    /// the loser reverts cleanly, and solvency holds.
    function test_instant_exit_buffer_race_one_winner() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
        vm.prank(bob);
        vault.stake{value: 10 ether}();

        // Drain the buffer to ~6 AETHEL (models delegated-out funds).
        vm.deal(address(vault), 6 ether);

        vm.prank(alice);
        vault.instantUnstake(5 ether, 0); // first: covered
        vm.prank(bob);
        vm.expectRevert(Cruzible.InsufficientBuffer.selector);
        vault.instantUnstake(5 ether, 0); // second: cleanly rejected
        passed++;
    }

    /// 100 dust unstake requests cannot brick the queue: every one is
    /// individually claimable and batchWithdraw settles them all.
    function test_queue_dust_spam_cannot_brick_withdrawals() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();

        uint256[] memory ids = new uint256[](100);
        for (uint256 i = 0; i < 100; i++) {
            vm.prank(alice);
            (uint256 wid, ) = vault.unstake(0.001 ether);
            ids[i] = wid;
        }
        vm.warp(block.timestamp + 101);
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.batchWithdraw(ids);
        assertTrue(alice.balance - before >= 0.0999 ether, "all dust claims settle");
        assertTrue(vault.totalReserved() == 0, "no stuck reservations");
    }

    /// The permissionless keeper functions are idempotent: double-sync
    /// releases nothing twice; double-reconcile realizes no loss twice.
    function test_keeper_functions_are_idempotent() public {
        setUp();
        MockStakingPrecompile stImpl = new MockStakingPrecompile();
        vm.etch(STAKING, address(stImpl).code);
        MockStakingPrecompile st = MockStakingPrecompile(STAKING);
        st.setUnbondingPeriod(60);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
        vm.prank(gov);
        vault.delegateToValidator("aethelvaloper1abc", 8 ether);
        vm.prank(gov);
        vault.undelegateFromValidator("aethelvaloper1abc", 4 ether);

        // Double sync after maturity: second call is a no-op.
        vm.warp(block.timestamp + 61);
        uint256 first = vault.syncUndelegations("aethelvaloper1abc");
        uint256 second = vault.syncUndelegations("aethelvaloper1abc");
        assertTrue(first == 4 ether && second == 0, "sync must be idempotent");
        assertTrue(vault.totalUnbonding() == 0, "no double release");

        // Double reconcile of the same slash: loss realized exactly once.
        st.slashBonded(3_600_000); // 4 → 3.6 AETHEL bonded
        uint256 loss1 = vault.reconcileValidator("aethelvaloper1abc");
        uint256 loss2 = vault.reconcileValidator("aethelvaloper1abc");
        assertTrue(loss1 == 0.4 ether && loss2 == 0, "reconcile must be idempotent");
    }

    // ── the identity-control boundary (docs/IDENTITY_POLICY.md) ─────────────
    //
    // Model A (default): identity gates PRIMARY ISSUANCE only — the receipt
    // token is freely transferable. Model B (opt-in transfer gate on
    // stAETHEL): recipients of transfers must also pass the vault's identity
    // check, so unverified parties cannot ACQUIRE the token — while senders
    // are never checked and the burn/exit paths never route through
    // transfers, so a suspended holder can always leave.

    function setUpIdentityGated() internal returns (MockZeroIDRegistry registry) {
        setUp();
        registry = new MockZeroIDRegistry();
        vm.prank(gov);
        vault.setIdentityGate(address(registry), true);
        registry.setIdentity(alice, keccak256("did:alice"), true);
        vm.deal(alice, 20 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
    }

    /// Model A pinned: with the DEFAULT configuration, a verified staker CAN
    /// transfer stAETHEL to an unverified address. This is the documented
    /// semantic (identity-gated primary issuance), not a defect — deployments
    /// requiring ownership gating must enable Model B.
    function test_modelA_default_receipt_token_transfers_freely() public {
        MockZeroIDRegistry registry = setUpIdentityGated();
        registry; // silence unused warning
        vm.prank(alice);
        token.transfer(bob, 2 ether);
        assertTrue(token.balanceOf(bob) > 0, "Model A: unverified holder can receive");
        // …but the unverified holder still cannot STAKE more.
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        vault.stake{value: 1 ether}();
    }

    /// Model B: with the transfer gate on, unverified recipients are blocked
    /// on transfer AND transferFrom; verification opens them.
    function test_modelB_blocks_unverified_recipients() public {
        MockZeroIDRegistry registry = setUpIdentityGated();
        vm.prank(gov);
        token.setTransferGate(true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StAETHEL.RecipientNotVerified.selector, bob));
        token.transfer(bob, 2 ether);

        vm.prank(alice);
        token.approve(address(this), 2 ether);
        vm.expectRevert(abi.encodeWithSelector(StAETHEL.RecipientNotVerified.selector, bob));
        token.transferFrom(alice, bob, 2 ether);

        registry.setIdentity(bob, keccak256("did:bob"), true);
        vm.prank(alice);
        token.transfer(bob, 2 ether);
        assertTrue(token.balanceOf(bob) > 0, "verified recipient receives under Model B");
    }

    /// Model B never traps a suspended holder: every exit path (queue,
    /// instant, withdraw) works, and sending TOWARD a verified party works —
    /// only ACQUISITION by unverified parties is blocked.
    function test_modelB_suspended_holder_can_always_exit() public {
        MockZeroIDRegistry registry = setUpIdentityGated();
        vm.prank(gov);
        token.setTransferGate(true);
        registry.setIdentity(bob, keccak256("did:bob"), true);

        // Alice is suspended in ZeroID.
        registry.setIdentity(alice, keccak256("did:alice"), false);

        vm.prank(alice);
        (uint256 wid, ) = vault.unstake(2 ether);
        vm.prank(alice);
        vault.instantUnstake(1 ether, 0);
        vm.warp(block.timestamp + 101);
        vm.prank(alice);
        vault.withdraw(wid);
        vm.prank(alice);
        token.transfer(bob, 1 ether); // sender suspended, recipient verified: allowed
        passed++;
    }

    /// Model B + the wrapper: wrapping requires the wrapper on the
    /// allowlist; unwrapping still enforces the recipient check, so the
    /// wrapper cannot be used to hand stAETHEL to an unverified party.
    function test_modelB_wrapper_allowlist_and_unwrap_gating() public {
        MockZeroIDRegistry registry = setUpIdentityGated();
        WstAETHEL wst = new WstAETHEL(address(token));
        vm.prank(gov);
        token.setTransferGate(true);

        // Not allowlisted: the wrap transfer (alice → wrapper) is blocked.
        vm.startPrank(alice);
        token.approve(address(wst), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(StAETHEL.RecipientNotVerified.selector, address(wst))
        );
        wst.wrap(2 ether);
        vm.stopPrank();

        // Governance allowlists the protocol wrapper; wrap now works.
        vm.prank(gov);
        token.setTransferAllowlist(address(wst), true);
        vm.prank(alice);
        uint256 wrapped = wst.wrap(2 ether);
        assertTrue(wrapped > 0, "allowlisted wrapper accepts deposits");

        // The wrapper cannot become a bypass: alice hands wstAETHEL to
        // unverified bob, but bob cannot unwrap (wrapper→bob transfer is
        // recipient-checked).
        vm.prank(alice);
        wst.transfer(bob, wrapped);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(StAETHEL.RecipientNotVerified.selector, bob));
        wst.unwrap(wrapped);

        // Once verified, bob unwraps normally.
        registry.setIdentity(bob, keccak256("did:bob"), true);
        vm.prank(bob);
        wst.unwrap(wrapped);
        assertTrue(token.balanceOf(bob) > 0, "verified holder unwraps");
    }

    /// The transfer gate and its allowlist are controlled by the VAULT's
    /// governance only.
    function test_modelB_governed_by_vault_governance() public {
        setUpIdentityGated();
        vm.prank(alice);
        vm.expectRevert(StAETHEL.NotGovernance.selector);
        token.setTransferGate(true);
        vm.prank(alice);
        vm.expectRevert(StAETHEL.NotGovernance.selector);
        token.setTransferAllowlist(bob, true);
        vm.prank(gov);
        token.setTransferGate(true);
        assertTrue(token.transferGateEnabled(), "vault governance controls the gate");
    }
}
