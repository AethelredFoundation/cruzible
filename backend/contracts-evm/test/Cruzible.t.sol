// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

import {Cruzible} from "../src/Cruzible.sol";
import {StAETHEL} from "../src/StAETHEL.sol";

/// Minimal Foundry cheatcode interface (hermetic — no forge-std dependency).
interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function deal(address, uint256) external;
    function warp(uint256) external;
    function etch(address, bytes calldata) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function label(address, string calldata) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

/// A mock ISeal deployed at 0x0900 so the compliance gate can be tested without
/// a live Aethelred node. It mirrors the precompile's observable behaviour:
/// getSealIdByJob, verifySeal, getSeal (purpose is what the gate binds on), and
/// requireConfidentiality (returns a preset verdict). The REAL precompile is
/// exercised separately in the chain repo's evmhost test.
contract MockISeal {
    mapping(string => string) public jobToSeal;
    mapping(string => bool) public active;
    mapping(string => string) public purpose;
    bool public policyOk = true;
    string public policyReason = "";

    function setSeal(string calldata jobId, string calldata sealId, bool isActive, string calldata purp) external {
        jobToSeal[jobId] = sealId;
        active[sealId] = isActive;
        purpose[sealId] = purp;
    }

    function setPolicy(bool ok, string calldata reason) external {
        policyOk = ok;
        policyReason = reason;
    }

    function getSealIdByJob(string calldata jobId) external view returns (string memory) {
        string memory s = jobToSeal[jobId];
        require(bytes(s).length != 0, "iseal: seal not found for job");
        return s;
    }

    function verifySeal(string calldata sealId) external view returns (bool) {
        return active[sealId];
    }

    function getSeal(string calldata sealId)
        external
        view
        returns (bytes32, bytes32, bytes32, int64, uint64, string memory, string memory, uint8, string memory)
    {
        return (bytes32(0), bytes32(0), bytes32(0), int64(0), uint64(0), "", purpose[sealId], uint8(2), sealId);
    }

    function requireConfidentiality(
        string calldata,
        string[] calldata,
        string calldata,
        string[] calldata,
        bool,
        string[] calldata
    ) external view returns (bool, string memory) {
        return (policyOk, policyReason);
    }
}

/// Mock ZeroID identity registry: the minimal surface Cruzible's identity
/// gate consumes (resolveByController + isActiveIdentity). The REAL registry
/// is ZeroID.sol in the zeroid repo — deployed alongside the vault in the
/// live devnet proof (scripts/devnet-identity-gate-e2e.mjs).
contract MockZeroIDRegistry {
    mapping(address => bytes32) internal didOf;
    mapping(bytes32 => bool) internal activeOf;

    function setIdentity(address controller, bytes32 did, bool active) external {
        didOf[controller] = did;
        activeOf[did] = active;
    }

    function resolveByController(address controller) external view returns (bytes32) {
        return didOf[controller];
    }

    function isActiveIdentity(bytes32 didHash) external view returns (bool) {
        return activeOf[didHash];
    }
}

/// Mock cosmos/evm staking precompile (0x0800): records the last delegate /
/// undelegate call so vault tests can assert argument encoding and the
/// 18→6-decimal conversion, and models the chain's bonded + unbonding state
/// (single validator, like the devnet) so queue-wiring and slashing
/// reconciliation can be tested. The REAL precompile also moves bank funds
/// (the vault's native balance drops); that effect is proven on the live
/// devnet (scripts/devnet-phase2-e2e.mjs / devnet-phase25-e2e.mjs), not
/// simulated here — tests mirror it with explicit vm.deal balance moves.
contract MockStakingPrecompile {
    struct Coin {
        string denom;
        uint256 amount;
    }

    struct UnbondingDelegationEntry {
        int64 creationHeight;
        int64 completionTime;
        uint256 initialBalance;
        uint256 balance;
        uint64 unbondingId;
        int64 unbondingOnHoldRefCount;
    }

    struct UnbondingDelegationOutput {
        string delegatorAddress;
        string validatorAddress;
        UnbondingDelegationEntry[] entries;
    }

    address public lastDelegator;
    string public lastValidator;
    uint256 public lastAmount;
    uint256 public delegateCalls;
    uint256 public undelegateCalls;
    bool public keepMaturedVisible;

    /// Chain-side state (uaethel): bonded principal + unbonding entries.
    uint256 public bondedUaethel;
    UnbondingDelegationEntry[] internal entries;
    /// @dev Set explicitly after vm.etch — etch copies code, NOT storage, so
    ///      a field initializer would silently read as zero on the precompile
    ///      address (instant maturity, breaking every unbonding test).
    uint256 public unbondingPeriod;

    function setUnbondingPeriod(uint256 period) external {
        unbondingPeriod = period;
    }

    function setKeepMaturedVisible(bool value) external {
        keepMaturedVisible = value;
    }

    function delegate(address delegatorAddress, string calldata validatorAddress, uint256 amount)
        external
        returns (bool)
    {
        lastDelegator = delegatorAddress;
        lastValidator = validatorAddress;
        lastAmount = amount;
        delegateCalls++;
        bondedUaethel += amount;
        return true;
    }

    function undelegate(address delegatorAddress, string calldata validatorAddress, uint256 amount)
        external
        returns (int64 completionTime)
    {
        lastDelegator = delegatorAddress;
        lastValidator = validatorAddress;
        lastAmount = amount;
        undelegateCalls++;
        bondedUaethel -= amount;
        completionTime = int64(uint64(block.timestamp + unbondingPeriod));
        entries.push(
            UnbondingDelegationEntry({
                creationHeight: int64(uint64(block.number)),
                completionTime: completionTime,
                initialBalance: amount,
                balance: amount,
                unbondingId: uint64(entries.length),
                unbondingOnHoldRefCount: 0
            })
        );
    }

    /// Simulate a slash of the bonded delegation (the query then reports less
    /// than the vault delegated).
    function slashBonded(uint256 newUaethel) external {
        bondedUaethel = newUaethel;
    }

    /// Simulate a slash hitting an entry that is still unbonding.
    function slashUnbonding(uint256 idx, uint256 newBalanceUaethel) external {
        entries[idx].balance = newBalanceUaethel;
    }

    function delegation(address, string calldata) external view returns (uint256 shares, Coin memory balance) {
        // Shares scale is irrelevant to the vault (it reads balance.amount).
        return (bondedUaethel * 1e18, Coin({denom: "uaethel", amount: bondedUaethel}));
    }

    function unbondingDelegation(address, string calldata)
        external
        view
        returns (UnbondingDelegationOutput memory out)
    {
        // The real chain removes matured entries at EndBlock; mirror that by
        // returning only entries whose completion is still in the future.
        uint256 n;
        for (uint256 i = 0; i < entries.length; i++) {
            if (keepMaturedVisible || uint64(entries[i].completionTime) > block.timestamp) n++;
        }
        out.entries = new UnbondingDelegationEntry[](n);
        uint256 j;
        for (uint256 i = 0; i < entries.length; i++) {
            if (keepMaturedVisible || uint64(entries[i].completionTime) > block.timestamp) {
                out.entries[j++] = entries[i];
            }
        }
    }
}

/// Mock cosmos/evm distribution precompile (0x0801): pays a preset native
/// reward to the delegator, mirroring how the real precompile credits the
/// withdrawn rewards to the delegator's (bridged) balance.
contract MockDistributionPrecompile {
    struct Coin {
        string denom;
        uint256 amount;
    }

    uint256 public rewardWei;

    function setReward(uint256 amount) external {
        rewardWei = amount;
    }

    function withdrawDelegatorRewards(address delegatorAddress, string calldata)
        external
        returns (Coin[] memory coins)
    {
        uint256 amount = rewardWei;
        rewardWei = 0;
        if (amount > 0) {
            // The REAL precompile credits the delegator's balance through the
            // stateDB — no CALL, no receive() needed on the delegator. Mirror
            // that exactly with the cheatcode balance write.
            Vm vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
            vm.deal(delegatorAddress, delegatorAddress.balance + amount);
        }
        coins = new Coin[](1);
        coins[0] = Coin({denom: "uaethel", amount: amount / 1e12});
    }
}

contract CruzibleTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant ISEAL = 0x0000000000000000000000000000000000000900;

    Cruzible vault;
    StAETHEL token;
    MockISeal seal;

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

        // Install the mock ISeal at the precompile address. etch copies code
        // but NOT storage, so the default policy verdict is set explicitly.
        MockISeal impl = new MockISeal();
        vm.etch(ISEAL, address(impl).code);
        seal = MockISeal(ISEAL);
        seal.setPolicy(true, "");
    }

    function assertEq(uint256 a, uint256 b, string memory what) internal {
        require(a == b, what);
        passed++;
    }

    function assertTrue(bool c, string memory what) internal {
        require(c, what);
        passed++;
    }

    /// Absolute-tolerance equality — the MINIMUM_LIQUIDITY dead-shares lock
    /// (1000 wei) makes exact balance assertions off by a negligible amount.
    function assertApprox(uint256 a, uint256 b, uint256 tol, string memory what) internal {
        uint256 diff = a > b ? a - b : b - a;
        require(diff <= tol, what);
        passed++;
    }

    // ── core liquid-staking invariants ───────────────────────────────────────

    function test_stake_rebase_unstake_withdraw() public {
        setUp();
        vm.deal(alice, 10 ether);

        vm.prank(alice);
        vault.stake{value: 5 ether}();
        // Balances are net of the 1000-wei dead-shares bootstrap lock.
        assertApprox(token.balanceOf(alice), 5 ether, 2000, "bootstrap balance ~= deposit");
        assertEq(token.sharesOf(alice), 5 ether - 1000, "bootstrap shares = deposit - locked");
        assertEq(vault.getExchangeRate(), 1 ether, "bootstrap rate = 1");

        // Rewards rebase every holder's balance up, shares unchanged.
        vm.deal(rewarder, 1 ether);
        // Opt into the guard's hard cap for large test rebases.
        vm.prank(gov);
        vault.setRateGuard(2000, 10 minutes);
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(rewarder);
        vault.addRewards{value: 1 ether}();
        assertApprox(token.balanceOf(alice), 6 ether, 2000, "balance rebased to ~6");
        assertEq(token.sharesOf(alice), 5 ether - 1000, "shares unchanged by rebase");
        assertEq(vault.getExchangeRate(), 1.2 ether, "rate = 1.2");

        // Unstake enters the unbonding queue at the current rate.
        vm.prank(alice);
        (uint256 wid, uint256 amt) = vault.unstake(2.5 ether); // half the shares
        assertEq(amt, 3 ether, "half of 6 = 3 AETHEL reserved");
        assertTrue(!vault.isWithdrawalClaimable(alice, wid), "not claimable during unbonding");

        vm.warp(block.timestamp + 101);
        assertTrue(vault.isWithdrawalClaimable(alice, wid), "claimable after unbonding");
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        vault.withdraw(wid);
        assertEq(alice.balance, balBefore + 3 ether, "native AETHEL paid out");

        // Remaining holder keeps the un-queued value.
        assertApprox(token.balanceOf(alice), 3 ether, 2000, "remaining balance ~= 3");
    }

    function test_two_stakers_share_rewards_pro_rata() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.prank(alice);
        vault.stake{value: 3 ether}();
        vm.prank(bob);
        vault.stake{value: 1 ether}();

        // pool 4 -> 8 (rate 2x) via guard-compliant 20%-capped reports
        vm.prank(gov);
        vault.setRateGuard(2000, 10 minutes);
        uint256 target = 8 ether;
        uint256 t = block.timestamp;
        while (vault.totalPooledAethel() < target) {
            uint256 step = (vault.totalPooledAethel() * 2000) / 10_000;
            uint256 remaining = target - vault.totalPooledAethel();
            if (step > remaining) step = remaining;
            t += 11 minutes;
            vm.warp(t);
            vm.deal(rewarder, step);
            vm.prank(rewarder);
            vault.addRewards{value: step}();
        }

        assertApprox(token.balanceOf(alice), 6 ether, 2000, "alice 3->~6 (75%)");
        assertEq(token.balanceOf(bob), 2 ether, "bob 1->2 (25%)");
    }

    function test_stake_with_min_shares_enforces_execution_rate() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        uint256 bootstrapShares = vault.stakeWithMinShares{value: 5 ether}(5 ether - 1000);
        assertEq(bootstrapShares, 5 ether - 1000, "bounded bootstrap returns minted shares");

        // Move the rate after a hypothetical 1:1 quote. Bob's transaction
        // must not silently mint fewer shares than the signed bound.
        vm.deal(rewarder, 0.25 ether);
        vm.prank(rewarder);
        vault.addRewards{value: 0.25 ether}();

        vm.deal(bob, 1 ether);
        uint256 actualShares = token.getSharesByAethel(1 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Cruzible.MinimumSharesNotMet.selector, 1 ether, actualShares));
        vault.stakeWithMinShares{value: 1 ether}(1 ether);
        assertEq(token.sharesOf(bob), 0, "failed bound mints no shares");
    }

    function test_unstake_with_min_aethel_is_atomic() public {
        setUp();
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vault.stake{value: 5 ether}();

        uint256 shares = 1 ether;
        uint256 quotedAethel = token.getAethelByShares(shares);
        uint256 sharesBefore = token.sharesOf(alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Cruzible.MinimumAethelNotMet.selector, quotedAethel + 1, quotedAethel));
        vault.unstakeWithMinAethel(shares, quotedAethel + 1);
        assertEq(token.sharesOf(alice), sharesBefore, "failed bound burns no shares");
        assertEq(vault.totalReserved(), 0, "failed bound creates no reservation");

        vm.prank(alice);
        (, uint256 aethelAmount) = vault.unstakeWithMinAethel(shares, quotedAethel);
        assertEq(aethelAmount, quotedAethel, "bounded exit reserves quoted AETHEL");
    }

    function test_partial_burn_emits_pre_burn_value_above_one_rate() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();

        vm.deal(rewarder, 0.5 ether);
        vm.prank(rewarder);
        vault.addRewards{value: 0.5 ether}();

        uint256 shares = 2 ether;
        uint256 expectedValue = token.getAethelByShares(shares);
        vm.recordLogs();
        vm.prank(alice);
        vault.unstakeWithMinAethel(shares, expectedValue);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 transferSignature = keccak256("Transfer(address,address,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(token) && logs[i].topics[0] == transferSignature) {
                assertTrue(logs[i].topics[1] == bytes32(uint256(uint160(alice))), "burn Transfer sender is alice");
                assertTrue(logs[i].topics[2] == bytes32(0), "burn Transfer recipient is zero");
                assertEq(abi.decode(logs[i].data, (uint256)), expectedValue, "burn event uses pre-burn value");
                found = true;
                break;
            }
        }
        assertTrue(found, "burn Transfer event found");
    }

    function test_unauthorized_calls_revert() public {
        setUp();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Cruzible.NotRewarder.selector);
        vault.addRewards{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert(Cruzible.NotGovernance.selector);
        vault.setComplianceRequired(true);
    }

    // ── the compliance moat: seal-gated staking ──────────────────────────────

    function test_compliance_gate_blocks_unadmitted() public {
        setUp();
        vm.prank(gov);
        vault.setComplianceRequired(true);

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectRevert(); // ComplianceGateClosed
        vault.stake{value: 5 ether}();
    }

    function test_compliance_gate_admits_with_bound_seal() public {
        setUp();
        vm.prank(gov);
        vault.setComplianceRequired(true);

        // A seal minted FOR alice: purpose binds her address, active, policy ok.
        string memory purp = string.concat("cruzible-stake:", _hex(alice));
        seal.setSeal("job-alice", "seal-alice", true, purp);

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vault.stakeWithSeal{value: 5 ether}("job-alice");
        assertApprox(token.balanceOf(alice), 5 ether, 2000, "admitted staker receives stAETHEL");
        assertTrue(vault.complianceAdmitted(alice), "alice admitted");

        // Once admitted, plain stake() works.
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vault.stake{value: 2 ether}();
        assertApprox(token.balanceOf(alice), 7 ether, 2000, "admitted staker can top up");
    }

    function test_seal_admission_rolls_back_when_min_shares_not_met() public {
        setUp();
        vm.prank(gov);
        vault.setComplianceRequired(true);

        string memory sealId = "seal-alice-bounded";
        string memory jobId = "job-alice-bounded";
        seal.setSeal(jobId, sealId, true, string.concat("cruzible-stake:", _hex(alice)));

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Cruzible.MinimumSharesNotMet.selector, 5 ether, 5 ether - 1000));
        vault.stakeWithSealAndMinShares{value: 5 ether}(jobId, 5 ether);
        assertTrue(!vault.complianceAdmitted(alice), "failed bound rolls admission back");
        assertTrue(!vault.sealUsed(sealId), "failed bound does not consume seal");

        vm.prank(alice);
        uint256 shares = vault.stakeWithSealAndMinShares{value: 5 ether}(jobId, 5 ether - 1000);
        assertEq(shares, 5 ether - 1000, "same seal succeeds with attainable bound");
    }

    function test_compliance_gate_rejects_seal_bound_to_other() public {
        setUp();
        vm.prank(gov);
        vault.setComplianceRequired(true);

        // Seal bound to BOB, alice tries to use it.
        seal.setSeal("job-bob", "seal-bob", true, string.concat("cruzible-stake:", _hex(bob)));
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectRevert(); // SealNotBoundToStaker
        vault.stakeWithSeal{value: 5 ether}("job-bob");
    }

    function test_compliance_gate_rejects_policy_violation() public {
        setUp();
        vm.prank(gov);
        vault.setComplianceRequired(true);

        seal.setSeal("job-alice", "seal-alice", true, string.concat("cruzible-stake:", _hex(alice)));
        seal.setPolicy(false, "jurisdiction outside permitted residency");

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectRevert(); // ComplianceGateClosed(reason)
        vault.stakeWithSeal{value: 5 ether}("job-alice");
    }

    function test_compliance_gate_rejects_seal_replay() public {
        setUp();
        vm.prank(gov);
        vault.setComplianceRequired(true);
        seal.setSeal("job-alice", "seal-alice", true, string.concat("cruzible-stake:", _hex(alice)));

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vault.stakeWithSeal{value: 5 ether}("job-alice");

        // A different staker cannot reuse the same seal.
        seal.setSeal("job-alice-2", "seal-alice", true, string.concat("cruzible-stake:", _hex(bob)));
        vm.deal(bob, 5 ether);
        vm.prank(bob);
        vm.expectRevert(); // SealAlreadyUsed
        vault.stakeWithSeal{value: 5 ether}("job-alice-2");
    }

    // ── production-hardening: share-inflation, solvency, governance ──────────

    function test_bootstrap_locks_dead_shares() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 5 ether}();
        // MINIMUM_LIQUIDITY shares are permanently locked to the dead address;
        // alice holds the remainder.
        assertEq(token.sharesOf(0x000000000000000000000000000000000000dEaD), 1000, "dead shares locked");
        assertEq(token.getTotalShares(), 5 ether, "total shares = deposit");
        assertEq(token.sharesOf(alice), 5 ether - 1000, "alice shares = deposit - locked");
    }

    function test_bootstrap_mint_events_do_not_overstate_supply() public {
        setUp();
        vm.deal(alice, 5 ether);
        vm.recordLogs();
        vm.prank(alice);
        vault.stake{value: 5 ether}();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 transferSignature = keccak256("Transfer(address,address,uint256)");
        uint256 mintedValue;
        uint256 mintEvents;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(token) && logs[i].topics[0] == transferSignature
                    && logs[i].topics[1] == bytes32(0)
            ) {
                mintedValue += abi.decode(logs[i].data, (uint256));
                mintEvents++;
            }
        }

        assertEq(mintEvents, 2, "bootstrap emits locked and user mints");
        assertEq(mintedValue, token.totalSupply(), "mint events equal rebasing supply");
    }

    function test_positive_transfer_that_rounds_to_zero_shares_reverts() public {
        setUp();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.stake{value: 1 ether}();
        vm.deal(rewarder, 0.05 ether);
        vm.prank(rewarder);
        vault.addRewards{value: 0.05 ether}();

        vm.prank(alice);
        vm.expectRevert(StAETHEL.TransferTooSmall.selector);
        token.transfer(bob, 1);
        assertEq(token.sharesOf(bob), 0, "dust transfer cannot report phantom value");
    }

    function test_transfer_cannot_round_amount_above_balance_down_to_held_shares() public {
        setUp();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.stake{value: 1 ether}();
        vm.deal(rewarder, 0.05 ether);
        vm.prank(rewarder);
        vault.addRewards{value: 0.05 ether}();

        uint256 balance = token.balanceOf(alice);
        // At a non-integer rate the raw-share conversion rounds down. The
        // requested token amount must still obey standard ERC-20 balance
        // semantics even when it maps to the sender's exact held shares.
        assertEq(token.getSharesByAethel(balance + 1), token.sharesOf(alice), "rounds to held shares");
        vm.prank(alice);
        vm.expectRevert(StAETHEL.InsufficientShares.selector);
        token.transfer(bob, balance + 1);
        assertEq(token.sharesOf(bob), 0, "over-balance transfer remains atomic");
    }

    function test_dust_bootstrap_reverts() public {
        setUp();
        vm.deal(alice, 10 ether);
        // A bootstrap deposit at or below MINIMUM_LIQUIDITY must revert.
        vm.prank(alice);
        vm.expectRevert(Cruzible.StakeTooSmall.selector);
        vault.stake{value: 1000}();
    }

    function test_inflation_attack_cannot_zero_out_victim() public {
        setUp();
        // Attacker bootstraps with a tiny (but valid) stake.
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        vault.stake{value: 1 ether}();

        // Rewards accrue over time, pushing the rate up massively. The rate
        // guard already blocks a single-tx 100x donation (the classic
        // inflation-attack setup), so this accumulates the same rate rise
        // through guard-compliant capped reports — proving the dead-shares
        // lock still defends the victim even after a huge CUMULATIVE rebase.
        vm.prank(gov);
        vault.setRateGuard(2000, 10 minutes);
        uint256 target = 101 ether;
        uint256 t = block.timestamp;
        while (vault.totalPooledAethel() < target) {
            uint256 step = (vault.totalPooledAethel() * 2000) / 10_000;
            uint256 remaining = target - vault.totalPooledAethel();
            if (step > remaining) step = remaining;
            t += 11 minutes;
            vm.warp(t);
            vm.deal(rewarder, step);
            vm.prank(rewarder);
            vault.addRewards{value: step}();
        }

        // A victim deposits an amount that (pre-fix) could round to 0 shares.
        // With the guard, either they receive > 0 shares or the tx reverts —
        // never "funds absorbed for 0 shares".
        vm.deal(bob, 100 ether);
        vm.prank(bob);
        uint256 got = vault.stake{value: 0.5 ether}();
        assertTrue(got > 0, "victim must receive non-zero shares");
        assertTrue(token.balanceOf(bob) > 0, "victim balance must be non-zero");
    }

    function test_solvency_invariant_holds_across_lifecycle() public {
        setUp();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(rewarder, 100 ether);

        vm.prank(alice);
        vault.stake{value: 10 ether}();
        vm.prank(bob);
        vault.stake{value: 5 ether}();
        // 3 ether on a 15-ether pool = 20%; opt into the guard's hard cap.
        vm.prank(gov);
        vault.setRateGuard(2000, 10 minutes);
        vm.prank(rewarder);
        vault.addRewards{value: 3 ether}();
        vm.prank(rewarder);
        vault.fundRewardsProgram{value: 2 ether}();

        vm.prank(alice);
        vault.unstake(2 ether); // shares -> reserved

        // Solvency: the contract holds exactly what it owes.
        assertEq(
            address(vault).balance,
            vault.totalPooledAethel() + vault.totalReserved() + vault.merkleReserve(),
            "balance == pooled + reserved + merkleReserve"
        );
    }

    function test_two_step_governance_transfer() public {
        setUp();
        address newGov = address(0x9017);

        // Only governance can nominate; nominee must accept.
        vm.prank(alice);
        vm.expectRevert(Cruzible.NotGovernance.selector);
        vault.transferGovernance(newGov);

        vm.prank(gov);
        vault.transferGovernance(newGov);
        // Old governance still in charge until acceptance.
        assertTrue(vault.governance() == gov, "gov unchanged before acceptance");

        // A non-nominee cannot accept.
        vm.prank(alice);
        vm.expectRevert(Cruzible.NotPendingGovernance.selector);
        vault.acceptGovernance();

        vm.prank(newGov);
        vault.acceptGovernance();
        assertTrue(vault.governance() == newGov, "gov handed over after acceptance");
    }

    function test_withdrawals_never_pausable() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 5 ether}();
        vm.prank(alice);
        (uint256 wid,) = vault.unstake(1 ether);

        // Pauser stops deposits...
        vm.prank(rewarder); // rewarder == pauser in setUp
        vault.setDepositsPaused(true);
        vm.deal(bob, 5 ether);
        vm.prank(bob);
        vm.expectRevert(Cruzible.DepositsArePaused.selector);
        vault.stake{value: 5 ether}();

        // ...but a matured withdrawal still succeeds (withdrawals are never gated).
        vm.warp(block.timestamp + 101);
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(wid);
        assertTrue(alice.balance > before, "withdrawal must succeed while deposits paused");
    }

    function _hex(address a) internal pure returns (string memory) {
        bytes20 data = bytes20(a);
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            out[2 + i * 2] = alphabet[uint8(data[i]) >> 4];
            out[3 + i * 2] = alphabet[uint8(data[i]) & 0x0f];
        }
        return string(out);
    }
    // ── Phase-1 sophistication: rate guard ──────────────────────────────────

    function test_addRewards_bounded_by_max_rebase() public {
        setUp();
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        vault.stake{value: 100 ether}();

        // 6% of the pool in one report exceeds the 5% default cap.
        vm.deal(rewarder, 10 ether);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(rewarder);
        vm.expectRevert(Cruzible.RebaseTooLarge.selector);
        vault.addRewards{value: 6 ether}();

        // 4% passes.
        vm.prank(rewarder);
        vault.addRewards{value: 4 ether}();
        assertEq(vault.totalPooledAethel(), 104 ether, "guarded reward applied");
    }

    function test_addRewards_min_interval() public {
        setUp();
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        vault.stake{value: 100 ether}();

        vm.deal(rewarder, 4 ether);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(rewarder);
        vault.addRewards{value: 2 ether}();

        // A second report inside the interval is rejected.
        vm.prank(rewarder);
        vm.expectRevert(Cruzible.RewardsTooFrequent.selector);
        vault.addRewards{value: 1 ether}();

        // After the interval passes, reporting resumes.
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(rewarder);
        vault.addRewards{value: 1 ether}();
        assertEq(vault.totalPooledAethel(), 103 ether, "post-interval reward applied");
    }

    function test_rate_guard_params_bounded_and_governed() public {
        setUp();

        // Governance can tune within hard bounds…
        vm.prank(gov);
        vault.setRateGuard(1000, 30 minutes);
        assertEq(vault.maxRebaseBps(), 1000, "cap updated");
        assertEq(vault.minRewardInterval(), 30 minutes, "interval updated");

        // …but not beyond them: >20% cap or <10min interval are rejected.
        vm.prank(gov);
        vm.expectRevert(Cruzible.BadParam.selector);
        vault.setRateGuard(2001, 1 hours);
        vm.prank(gov);
        vm.expectRevert(Cruzible.BadParam.selector);
        vault.setRateGuard(500, 9 minutes);

        // And only governance holds the dial.
        vm.prank(alice);
        vm.expectRevert(Cruzible.NotGovernance.selector);
        vault.setRateGuard(500, 1 hours);
    }

    // ── Phase-1 sophistication: instant unstake ─────────────────────────────

    function test_instant_unstake_pays_from_buffer_with_fee() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
        vm.prank(bob);
        vault.stake{value: 10 ether}();

        uint256 shares = token.sharesOf(alice) / 2;
        uint256 amount = token.getAethelByShares(shares);
        uint256 fee = (amount * vault.instantExitFeeBps()) / 10_000;
        uint256 balBefore = alice.balance;
        uint256 bobBefore = token.balanceOf(bob);

        vm.prank(alice);
        uint256 paid = vault.instantUnstake(shares, amount - fee);

        assertEq(paid, amount - fee, "payout = value minus instant-exit fee");
        assertEq(alice.balance - balBefore, paid, "native AETHEL arrived immediately");
        // The fee stays in the pool: every remaining holder rebases upward.
        assertTrue(token.balanceOf(bob) > bobBefore, "fee accrues to remaining stakers");
        // The queue path's reservations are untouched.
        assertEq(vault.totalReserved(), 0, "no queue reservation consumed");
    }

    function test_instant_unstake_reverts_when_buffer_dry() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();

        // While every pooled AETHEL sits in the vault, the buffer always
        // covers instant exits. The dry case is the Phase-2 reality —
        // pooled funds DELEGATED out to validators — which we model by
        // draining the vault's native balance directly.
        vm.deal(address(vault), 2 ether);

        uint256 aliceShares = token.sharesOf(alice);
        vm.prank(alice);
        vm.expectRevert(Cruzible.InsufficientBuffer.selector);
        vault.instantUnstake(aliceShares, 0);
    }

    function test_instant_unstake_min_out_slippage() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();

        uint256 shares = token.sharesOf(alice) / 2;
        uint256 amount = token.getAethelByShares(shares);
        vm.prank(alice);
        vm.expectRevert(Cruzible.SlippageExceeded.selector);
        vault.instantUnstake(shares, amount + 1); // demands more than value-minus-fee
    }

    function test_instant_exit_fee_governed_and_capped() public {
        setUp();
        vm.prank(gov);
        vault.setInstantExitFee(100);
        assertEq(vault.instantExitFeeBps(), 100, "fee updated");

        vm.prank(gov);
        vm.expectRevert(Cruzible.BadParam.selector);
        vault.setInstantExitFee(201); // hard cap 2%

        vm.prank(alice);
        vm.expectRevert(Cruzible.NotGovernance.selector);
        vault.setInstantExitFee(10);
    }

    // ── Phase-2 real yield: delegation plumbing + earned rewards ────────────

    address constant STAKING = 0x0000000000000000000000000000000000000800;
    address constant DISTRIBUTION = 0x0000000000000000000000000000000000000801;

    function setUpStakingMocks() internal returns (MockStakingPrecompile st, MockDistributionPrecompile dist) {
        MockStakingPrecompile stImpl = new MockStakingPrecompile();
        vm.etch(STAKING, address(stImpl).code);
        st = MockStakingPrecompile(STAKING);
        st.setUnbondingPeriod(60); // etch copies code only — set storage explicitly
        MockDistributionPrecompile distImpl = new MockDistributionPrecompile();
        vm.etch(DISTRIBUTION, address(distImpl).code);
        dist = MockDistributionPrecompile(payable(DISTRIBUTION));
    }

    function test_delegate_converts_to_bond_denom_and_tracks() public {
        setUp();
        (MockStakingPrecompile st,) = setUpStakingMocks();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();

        vm.prank(gov);
        vault.delegateToValidator("aethelvaloper1abc", 4 ether);

        assertEq(vault.totalDelegated(), 4 ether, "delegated tracked in wei accounting");
        assertEq(st.lastAmount(), 4 ether / 1e12, "precompile amount in uaethel (6-dec)");
        assertEq(st.delegateCalls(), 1, "delegate called once");
        assertTrue(st.lastDelegator() == address(vault), "vault is the delegator");
    }

    function test_delegate_rejects_dusty_and_oversized_amounts() public {
        setUp();
        setUpStakingMocks();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();

        // Not a whole uaethel multiple: the 1e12 bridge would silently drop dust.
        vm.prank(gov);
        vm.expectRevert(Cruzible.BadParam.selector);
        vault.delegateToValidator("aethelvaloper1abc", 4 ether + 1);

        // More than the free buffer (queue/merkle reservations are untouchable).
        vm.prank(gov);
        vm.expectRevert(Cruzible.InsufficientBuffer.selector);
        vault.delegateToValidator("aethelvaloper1abc", 11 ether);

        // Governance-only.
        vm.prank(alice);
        vm.expectRevert(Cruzible.NotGovernance.selector);
        vault.delegateToValidator("aethelvaloper1abc", 1 ether);
    }

    function test_undelegate_reduces_tracking() public {
        setUp();
        (MockStakingPrecompile st,) = setUpStakingMocks();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
        vm.prank(gov);
        vault.delegateToValidator("aethelvaloper1abc", 4 ether);

        vm.prank(gov);
        vault.undelegateFromValidator("aethelvaloper1abc", 3 ether);
        assertEq(vault.totalDelegated(), 1 ether, "undelegation reduces tracking");
        assertEq(st.undelegateCalls(), 1, "undelegate called once");
        assertEq(st.lastAmount(), 3 ether / 1e12, "undelegate amount in uaethel");

        // Cannot undelegate more than is tracked as delegated.
        vm.prank(gov);
        vm.expectRevert(Cruzible.BadParam.selector);
        vault.undelegateFromValidator("aethelvaloper1abc", 2 ether);
    }

    function test_claim_staking_rewards_folds_earned_yield_into_rate() public {
        setUp();
        (, MockDistributionPrecompile dist) = setUpStakingMocks();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();

        uint256 rateBefore = vault.getExchangeRate();
        uint256 balBefore = token.balanceOf(alice);

        // The chain owes the vault 1 AETHEL of REAL staking rewards.
        vm.deal(DISTRIBUTION, 1 ether);
        dist.setReward(1 ether);

        // Permissionless: anyone may trigger the claim — rewards are
        // consensus truth and benefit every staker.
        vm.prank(bob);
        uint256 claimed = vault.claimStakingRewards("aethelvaloper1abc");

        assertEq(claimed, 1 ether, "claimed the earned rewards");
        assertTrue(vault.getExchangeRate() > rateBefore, "earned yield raises the rate");
        assertTrue(token.balanceOf(alice) > balBefore, "every staker rebases upward");
    }

    function test_claim_with_no_rewards_is_a_noop() public {
        setUp();
        setUpStakingMocks();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();

        uint256 rateBefore = vault.getExchangeRate();
        uint256 claimed = vault.claimStakingRewards("aethelvaloper1abc");
        assertEq(claimed, 0, "nothing to claim");
        assertEq(vault.getExchangeRate(), rateBefore, "rate unchanged");
    }

    // ── Phase-2.5: queue↔undelegation wiring + slashing accounting ──────────

    string constant VAL = "aethelvaloper1abc";

    /// alice staked 10, 8 delegated out: buffer 2, delegatedTo[VAL] 8. The
    /// vm.deal mirrors the REAL precompile's bank move (delegated funds leave
    /// the vault's native balance), which the mock cannot perform.
    function setUpDelegatedVault() internal returns (MockStakingPrecompile st, MockDistributionPrecompile dist) {
        (st, dist) = setUpStakingMocks();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
        vm.prank(gov);
        vault.delegateToValidator(VAL, 8 ether);
        vm.deal(address(vault), address(vault).balance - 8 ether);
    }

    function test_undelegate_for_queue_is_permissionless_and_deficit_bounded() public {
        setUp();
        (MockStakingPrecompile st,) = setUpDelegatedVault();

        // No deficit yet: the buffer covers every promise.
        vm.prank(bob);
        vm.expectRevert(Cruzible.NoQueueDeficit.selector);
        vault.undelegateForQueue(VAL);

        // Alice queues an exit worth 5 AETHEL; only 2 sit in the buffer.
        vm.prank(alice);
        vault.unstake(5 ether);
        assertEq(vault.queueDeficit(), 3 ether, "deficit = promised - (balance + in-flight)");

        // ANYONE can cover the queue — the amount is computed, not chosen:
        // exactly the deficit, so the permissionless path cannot over-undelegate.
        vm.prank(bob);
        uint256 undelegated = vault.undelegateForQueue(VAL);
        assertEq(undelegated, 3 ether, "undelegates exactly the deficit");
        assertEq(vault.totalDelegated(), 5 ether, "bonded tracking reduced");
        assertEq(vault.delegatedTo(VAL), 5 ether, "per-validator tracking reduced");
        assertEq(vault.totalUnbonding(), 3 ether, "in-flight unbonding tracked");
        assertEq(vault.queueDeficit(), 0, "in-flight unbonding counts as queue coverage");
        assertEq(st.undelegateCalls(), 1, "one precompile undelegation");

        // With the queue covered, the permissionless path is closed again.
        vm.prank(bob);
        vm.expectRevert(Cruzible.NoQueueDeficit.selector);
        vault.undelegateForQueue(VAL);
    }

    function test_matured_undelegations_release_coverage_and_fund_withdrawals() public {
        setUp();
        setUpDelegatedVault();
        vm.prank(alice);
        (uint256 wid,) = vault.unstake(5 ether);
        vm.prank(bob);
        vault.undelegateForQueue(VAL);

        // The chain pays the vault when its unbonding period (60s in the mock)
        // completes — simulate the bank credit alongside the passage of time.
        vm.warp(block.timestamp + 61);
        vm.deal(address(vault), address(vault).balance + 3 ether);
        uint256 matured = vault.syncUndelegations(VAL);
        assertEq(matured, 3 ether, "matured entries popped from the FIFO");
        assertEq(vault.totalUnbonding(), 0, "no more in-flight unbonding");

        // Alice's queued withdrawal (vault unbonding 100s) is now fully funded.
        vm.warp(block.timestamp + 40);
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(wid);
        assertEq(alice.balance - before, 5 ether, "queued exit paid in full");
    }

    function test_sync_waits_for_consensus_to_remove_matured_entry() public {
        setUp();
        (MockStakingPrecompile st,) = setUpDelegatedVault();
        vm.prank(gov);
        vault.undelegateFromValidator(VAL, 3 ether);

        vm.warp(block.timestamp + 61);
        st.setKeepMaturedVisible(true);
        assertEq(vault.syncUndelegations(VAL), 0, "local timestamp cannot outrun consensus settlement");
        assertEq(vault.totalUnbonding(), 3 ether, "in-flight coverage remains while chain reports entry");

        st.setKeepMaturedVisible(false);
        vm.deal(address(vault), address(vault).balance + 3 ether);
        assertEq(vault.syncUndelegations(VAL), 3 ether, "settled entry releases after consensus removal");
    }

    function test_matured_unbonding_slash_is_realized_without_pre_maturity_keeper() public {
        setUp();
        (MockStakingPrecompile st,) = setUpDelegatedVault();
        vm.prank(gov);
        vault.undelegateFromValidator(VAL, 4 ether);

        // No keeper reconciles before maturity. Consensus removes the entry
        // and credits only the post-slash 3.6 AETHEL payout.
        st.slashUnbonding(0, 3_600_000);
        vm.warp(block.timestamp + 61);
        vm.deal(address(vault), address(vault).balance + 3.6 ether);
        assertEq(vault.syncUndelegations(VAL), 4 ether, "recorded entry settles exactly once");
        assertEq(vault.totalUnbonding(), 0, "removed entry is no longer counted in flight");
        assertEq(vault.totalPooledAethel(), 9.6 ether, "missing maturity payout is socialized immediately");
        assertEq(vault.uncoveredDeficit(), 0, "active pool fully absorbs slash");
        assertEq(
            vault.totalManaged(),
            vault.totalPooledAethel() + vault.totalReserved() + vault.merkleReserve(),
            "post-settlement balance sheet remains solvent"
        );
    }

    function test_catastrophic_maturity_loss_fails_closed_until_recapitalized() public {
        setUp();
        (MockStakingPrecompile st,) = setUpDelegatedVault();
        uint256 allAliceShares = token.sharesOf(alice);
        vm.prank(alice);
        (uint256 withdrawalId,) = vault.unstake(allAliceShares);
        vm.prank(bob);
        vault.undelegateForQueue(VAL);

        st.slashUnbonding(0, 7_000_000);
        vm.warp(block.timestamp + 101);
        vm.deal(address(vault), address(vault).balance + 7 ether);
        vault.syncUndelegations(VAL);

        uint256 deficit = vault.uncoveredDeficit();
        assertTrue(deficit > 0, "loss beyond active pool is explicit");
        assertTrue(vault.depositsPaused(), "catastrophic loss pauses deposits");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Cruzible.ProtocolInsolvent.selector, deficit));
        vault.withdraw(withdrawalId);

        vm.deal(bob, deficit);
        vm.prank(bob);
        vault.recapitalize{value: deficit}();
        assertEq(vault.uncoveredDeficit(), 0, "recapitalization clears explicit gap");

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(withdrawalId);
        assertTrue(alice.balance > before, "queued claim resumes only after assets are restored");
    }

    function test_total_managed_covers_all_promises_across_delegation() public {
        setUp();
        setUpDelegatedVault();
        vm.prank(alice);
        vault.unstake(5 ether);
        vm.prank(bob);
        vault.undelegateForQueue(VAL);
        // The solvency invariant, generalized for Phase 2: assets under
        // management (balance + bonded + unbonding) cover every liability.
        assertEq(
            vault.totalManaged(),
            vault.totalPooledAethel() + vault.totalReserved() + vault.merkleReserve(),
            "balance + delegated + unbonding == pooled + reserved + merkleReserve"
        );
    }

    function test_reconcile_realizes_bonded_slash_and_socializes() public {
        setUp();
        (MockStakingPrecompile st,) = setUpDelegatedVault();

        // The chain slashed the validator 10%: the vault's on-chain delegation
        // is now 7.2 AETHEL while the vault still records 8.
        st.slashBonded(7_200_000);

        uint256 rateBefore = vault.getExchangeRate();
        vm.prank(bob); // permissionless: reads chain truth, only corrects DOWN
        uint256 loss = vault.reconcileValidator(VAL);

        assertEq(loss, 0.8 ether, "loss = recorded - chain truth");
        assertEq(vault.totalDelegated(), 7.2 ether, "bonded tracking matches chain");
        assertEq(vault.delegatedTo(VAL), 7.2 ether, "per-validator tracking matches chain");
        assertEq(vault.totalPooledAethel(), 9.2 ether, "loss socialized across the pool");
        assertTrue(vault.getExchangeRate() < rateBefore, "rate honestly reflects the slash");

        // Reconcile is idempotent: a second run realizes nothing new.
        assertEq(vault.reconcileValidator(VAL), 0, "second reconcile is a no-op");
    }

    function test_reconcile_realizes_unbonding_slash() public {
        setUp();
        (MockStakingPrecompile st,) = setUpDelegatedVault();
        vm.prank(gov);
        vault.undelegateFromValidator(VAL, 4 ether);
        assertEq(vault.totalUnbonding(), 4 ether, "governance undelegation also tracked");

        // The validator is slashed while the entry is still unbonding: the
        // chain's entry balance drops from 4 to 3.6 AETHEL.
        st.slashUnbonding(0, 3_600_000);

        vm.prank(bob);
        uint256 loss = vault.reconcileValidator(VAL);
        assertEq(loss, 0.4 ether, "unbonding slash realized");
        assertEq(vault.totalUnbonding(), 3.6 ether, "in-flight tracking matches chain");
        assertEq(vault.totalPooledAethel(), 9.6 ether, "loss socialized");

        // Maturity then releases the post-slash amount — the FIFO entry was
        // adjusted by the reconcile, so accounting stays exact.
        vm.warp(block.timestamp + 61);
        vm.deal(address(vault), address(vault).balance + 3.6 ether);
        assertEq(vault.syncUndelegations(VAL), 3.6 ether, "post-slash maturity");
        assertEq(vault.totalUnbonding(), 0, "in-flight fully released");
    }

    // ── the identity layer: ZeroID-gated staking (three-way integration) ────

    function test_identity_gate_blocks_unregistered_staker() public {
        setUp();
        MockZeroIDRegistry registry = new MockZeroIDRegistry();
        vm.prank(gov);
        vault.setIdentityGate(address(registry), true);

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vm.expectRevert(); // IdentityGateClosed: no identity registered
        vault.stake{value: 5 ether}();
    }

    function test_identity_gate_admits_active_identity() public {
        setUp();
        MockZeroIDRegistry registry = new MockZeroIDRegistry();
        vm.prank(gov);
        vault.setIdentityGate(address(registry), true);

        registry.setIdentity(alice, keccak256("did:zeroid:alice"), true);
        assertTrue(vault.isIdentityVerified(alice), "view reflects active identity");

        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vault.stake{value: 5 ether}();
        assertApprox(token.balanceOf(alice), 5 ether, 2000, "verified staker admitted");
    }

    function test_identity_gate_blocks_revoked_identity_live() public {
        setUp();
        MockZeroIDRegistry registry = new MockZeroIDRegistry();
        vm.prank(gov);
        vault.setIdentityGate(address(registry), true);

        // Alice registers, stakes, then her identity is suspended/revoked in
        // ZeroID: the NEXT stake is blocked — the check is live per stake,
        // not a cached admission.
        bytes32 did = keccak256("did:zeroid:alice");
        registry.setIdentity(alice, did, true);
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 5 ether}();

        registry.setIdentity(alice, did, false);
        assertTrue(!vault.isIdentityVerified(alice), "view reflects revocation");
        vm.prank(alice);
        vm.expectRevert(); // IdentityGateClosed: identity not active
        vault.stake{value: 2 ether}();

        // Exits are NEVER identity-gated: a revoked identity can still leave.
        vm.prank(alice);
        (uint256 wid,) = vault.unstake(1 ether);
        vm.warp(block.timestamp + 101);
        vm.prank(alice);
        vault.withdraw(wid);
        passed++;
    }

    function test_identity_gate_governed_and_validated() public {
        setUp();
        MockZeroIDRegistry registry = new MockZeroIDRegistry();

        // Only governance holds the dial.
        vm.prank(alice);
        vm.expectRevert(Cruzible.NotGovernance.selector);
        vault.setIdentityGate(address(registry), true);

        // Requiring identity with no registry configured is invalid.
        vm.prank(gov);
        vm.expectRevert(Cruzible.BadParam.selector);
        vault.setIdentityGate(address(0), true);

        // Gate off (default): unregistered stakers pass.
        vm.deal(bob, 2 ether);
        vm.prank(bob);
        vault.stake{value: 2 ether}();
        passed++;
    }

    function test_identity_gate_composes_with_seal_gate() public {
        setUp();
        MockZeroIDRegistry registry = new MockZeroIDRegistry();
        vm.startPrank(gov);
        vault.setIdentityGate(address(registry), true);
        vault.setComplianceRequired(true);
        vm.stopPrank();

        // Identity alone is not enough — the seal gate still binds…
        registry.setIdentity(alice, keccak256("did:zeroid:alice"), true);
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(); // ComplianceGateClosed
        vault.stake{value: 5 ether}();

        // …and a valid seal alone is not enough for an unregistered staker.
        seal.setSeal("job-bob", "seal-bob", true, string.concat("cruzible-stake:", _hex(bob)));
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(); // IdentityGateClosed
        vault.stakeWithSeal{value: 5 ether}("job-bob");

        // Both layers satisfied → admitted.
        seal.setSeal("job-alice", "seal-alice", true, string.concat("cruzible-stake:", _hex(alice)));
        vm.prank(alice);
        vault.stakeWithSeal{value: 5 ether}("job-alice");
        assertApprox(token.balanceOf(alice), 5 ether, 2000, "identity + seal both satisfied");
    }

    function test_undelegate_for_queue_caps_at_validator_delegation() public {
        setUp();
        setUpStakingMocks();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.stake{value: 10 ether}();
        // Only 2 delegated to VAL; the rest of the pool stays in the buffer.
        vm.prank(gov);
        vault.delegateToValidator(VAL, 2 ether);
        vm.deal(address(vault), address(vault).balance - 2 ether);

        // Alice queues a full exit worth 10: deficit 2 beyond the 8 buffer.
        vm.prank(alice);
        vault.unstake(10 ether - 1000); // her entire share balance
        assertTrue(vault.queueDeficit() > 0, "queue under-covered");

        // The permissionless cover takes everything VAL has, no more.
        vm.prank(bob);
        uint256 undelegated = vault.undelegateForQueue(VAL);
        assertEq(undelegated, 2 ether, "capped at the validator's delegation");
        assertEq(vault.delegatedTo(VAL), 0, "validator fully undelegated");
    }
}
