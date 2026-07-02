// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

import {Cruzible} from "../src/Cruzible.sol";
import {StAETHEL} from "../src/StAETHEL.sol";

/// Minimal Foundry cheatcode interface (hermetic — no forge-std dependency).
interface Vm {
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

    // ── core liquid-staking invariants ───────────────────────────────────────

    function test_stake_rebase_unstake_withdraw() public {
        setUp();
        vm.deal(alice, 10 ether);

        vm.prank(alice);
        vault.stake{value: 5 ether}();
        assertEq(token.balanceOf(alice), 5 ether, "bootstrap balance = deposit");
        assertEq(token.sharesOf(alice), 5 ether, "bootstrap shares = deposit");
        assertEq(vault.getExchangeRate(), 1 ether, "bootstrap rate = 1");

        // Rewards rebase every holder's balance up, shares unchanged.
        vm.deal(rewarder, 1 ether);
        vm.prank(rewarder);
        vault.addRewards{value: 1 ether}();
        assertEq(token.balanceOf(alice), 6 ether, "balance rebased to 6");
        assertEq(token.sharesOf(alice), 5 ether, "shares unchanged by rebase");
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
        assertEq(token.balanceOf(alice), 3 ether, "remaining balance = 3");
    }

    function test_two_stakers_share_rewards_pro_rata() public {
        setUp();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.prank(alice);
        vault.stake{value: 3 ether}();
        vm.prank(bob);
        vault.stake{value: 1 ether}();

        vm.deal(rewarder, 4 ether);
        vm.prank(rewarder);
        vault.addRewards{value: 4 ether}(); // pool 4 -> 8, rate 2x

        assertEq(token.balanceOf(alice), 6 ether, "alice 3->6 (75%)");
        assertEq(token.balanceOf(bob), 2 ether, "bob 1->2 (25%)");
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
        assertEq(token.balanceOf(alice), 5 ether, "admitted staker receives stAETHEL");
        assertTrue(vault.complianceAdmitted(alice), "alice admitted");

        // Once admitted, plain stake() works.
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vault.stake{value: 2 ether}();
        assertEq(token.balanceOf(alice), 7 ether, "admitted staker can top up");
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
}
