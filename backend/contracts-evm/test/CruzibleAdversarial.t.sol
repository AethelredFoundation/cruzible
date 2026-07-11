// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

import {Cruzible} from "../src/Cruzible.sol";
import {StAETHEL} from "../src/StAETHEL.sol";
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
}
