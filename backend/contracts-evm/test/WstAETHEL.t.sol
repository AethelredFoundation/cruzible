// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

import {Cruzible} from "../src/Cruzible.sol";
import {StAETHEL} from "../src/StAETHEL.sol";
import {WstAETHEL} from "../src/WstAETHEL.sol";

/// Minimal Foundry cheatcode interface (hermetic — no forge-std dependency).
interface Vm {
    function prank(address) external;
    function deal(address, uint256) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function sign(uint256, bytes32) external pure returns (uint8, bytes32, bytes32);
    function addr(uint256) external pure returns (address);
}

contract ReentrantStAethelMock {
    WstAETHEL internal wrapper;
    mapping(address => uint256) internal accountShares;
    bool internal attack;

    function configure(WstAETHEL wrapper_) external {
        wrapper = wrapper_;
        attack = true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferShares(address, uint256 amount) external pure returns (uint256) {
        return amount;
    }

    function transferFrom(address, address to, uint256 amount) external returns (bool) {
        if (attack) {
            attack = false;
            wrapper.wrap(1);
        }
        accountShares[to] += amount;
        return true;
    }

    function sharesOf(address account) external view returns (uint256) {
        return accountShares[account];
    }

    function getSharesByAethel(uint256 amount) external pure returns (uint256) {
        return amount;
    }

    function getAethelByShares(uint256 amount) external pure returns (uint256) {
        return amount;
    }
}

/// WstAETHEL — the wstETH pattern over rebasing stAETHEL.
///
/// Invariants pinned here:
///   - wrap locks stAETHEL and mints a FIXED balance equal to the underlying
///     share count; rebases never change a wst balance
///   - value accrues via the redemption rate: unwrap after a rebase returns
///     MORE stAETHEL than was wrapped
///   - EIP-2612 permit sets allowances by signature (and rejects expired or
///     replayed permits), so integrators get gasless approvals
contract WstAETHELTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    Cruzible internal vault;
    StAETHEL internal token;
    WstAETHEL internal wst;

    address internal gov = address(0xA11CE);
    address internal rewarder = address(0xBEEF);
    uint256 internal alicePk = 0xA11CE0;
    address internal alice;

    uint256 internal passed;

    function setUp() internal {
        vault = new Cruzible(gov, rewarder, rewarder, 100);
        token = new StAETHEL(address(vault));
        vm.prank(gov);
        vault.setStAethel(address(token));
        wst = new WstAETHEL(address(token));
        alice = vm.addr(alicePk);
    }

    function assertEq(uint256 a, uint256 b, string memory what) internal {
        require(a == b, what);
        passed++;
    }

    function assertTrue(bool c, string memory what) internal {
        require(c, what);
        passed++;
    }

    function assertApprox(uint256 a, uint256 b, uint256 tol, string memory what) internal {
        uint256 diff = a > b ? a - b : b - a;
        require(diff <= tol, what);
        passed++;
    }

    function _stakeAlice(uint256 amount) internal {
        vm.deal(alice, amount);
        vm.prank(alice);
        vault.stake{value: amount}();
    }

    function test_wrap_mints_share_denominated_balance() public {
        setUp();
        _stakeAlice(10 ether);

        uint256 stAmount = 4 ether;
        uint256 expectedWst = token.getSharesByAethel(stAmount);

        vm.prank(alice);
        token.approve(address(wst), stAmount);
        vm.prank(alice);
        uint256 minted = wst.wrap(stAmount);

        assertApprox(minted, expectedWst, 2, "wst minted = underlying shares");
        assertApprox(wst.balanceOf(alice), minted, 0, "wst credited");
        assertApprox(token.balanceOf(address(wst)), stAmount, 2, "stAETHEL locked in wrapper");
    }

    function test_rebase_leaves_wst_balance_fixed_and_grows_redemption() public {
        setUp();
        _stakeAlice(10 ether);

        vm.prank(alice);
        token.approve(address(wst), 4 ether);
        vm.prank(alice);
        uint256 minted = wst.wrap(4 ether);

        uint256 redemptionBefore = wst.stAethelPerToken();

        // Rewards rebase every stAETHEL balance (within the rate guard).
        vm.deal(rewarder, 0.5 ether);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(rewarder);
        vault.addRewards{value: 0.5 ether}();

        assertEq(wst.balanceOf(alice), minted, "wst balance never rebases");
        assertTrue(wst.stAethelPerToken() > redemptionBefore, "redemption rate grew");

        // Unwrapping returns MORE stAETHEL than was wrapped — the accrual.
        vm.prank(alice);
        uint256 returned = wst.unwrap(minted);
        assertTrue(returned > 4 ether, "unwrap returns accrued value");
        assertEq(wst.balanceOf(alice), 0, "wst burned");
    }

    function test_unwrap_moves_exact_raw_shares_at_odd_exchange_rate() public {
        setUp();
        _stakeAlice(10 ether);
        vm.prank(gov);
        vault.setRateGuard(2000, 10 minutes);
        vm.deal(rewarder, 1.01 ether);
        vm.prank(rewarder);
        vault.addRewards{value: 1.01 ether}(); // P=11.01, S=10: double-floor is observable.

        vm.prank(alice);
        token.approve(address(wst), 1 ether);
        vm.prank(alice);
        wst.wrap(1 ether);

        uint256 wstAmount = 100;
        uint256 wrapperSharesBefore = token.sharesOf(address(wst));
        uint256 aliceSharesBefore = token.sharesOf(alice);
        vm.prank(alice);
        wst.unwrap(wstAmount);

        assertEq(wrapperSharesBefore - token.sharesOf(address(wst)), wstAmount, "wrapper releases exact raw shares");
        assertEq(token.sharesOf(alice) - aliceSharesBefore, wstAmount, "recipient receives exact raw shares");
    }

    function test_wrap_unwrap_zero_reverts() public {
        setUp();
        _stakeAlice(1 ether);
        vm.prank(alice);
        vm.expectRevert(WstAETHEL.ZeroAmount.selector);
        wst.wrap(0);
        vm.prank(alice);
        vm.expectRevert(WstAETHEL.ZeroAmount.selector);
        wst.unwrap(0);
    }

    function test_wrap_rejects_token_callback_reentrancy() public {
        ReentrantStAethelMock maliciousToken = new ReentrantStAethelMock();
        WstAETHEL guardedWrapper = new WstAETHEL(address(maliciousToken));
        maliciousToken.configure(guardedWrapper);

        vm.expectRevert(WstAETHEL.Reentrancy.selector);
        guardedWrapper.wrap(2 ether);
        assertEq(guardedWrapper.totalSupply(), 0, "reentrant wrap cannot mint unbacked wst");
    }

    function test_erc20_transfer_and_approve() public {
        setUp();
        _stakeAlice(10 ether);
        vm.prank(alice);
        token.approve(address(wst), 2 ether);
        vm.prank(alice);
        uint256 minted = wst.wrap(2 ether);

        address bob = address(0xB0B);
        vm.prank(alice);
        assertTrue(wst.transfer(bob, minted / 2), "transfer ok");
        assertEq(wst.balanceOf(bob), minted / 2, "bob credited");

        vm.prank(bob);
        wst.approve(alice, minted / 4);
        vm.prank(alice);
        assertTrue(wst.transferFrom(bob, alice, minted / 4), "transferFrom within allowance");
        assertEq(wst.allowance(bob, alice), 0, "allowance consumed");
    }

    function test_permit_sets_allowance_by_signature() public {
        setUp();
        _stakeAlice(2 ether);
        vm.prank(alice);
        token.approve(address(wst), 1 ether);
        vm.prank(alice);
        wst.wrap(1 ether);

        address spender = address(0x5137);
        uint256 value = 123;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 structHash =
            keccak256(abi.encode(wst.PERMIT_TYPEHASH(), alice, spender, value, wst.nonces(alice), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", wst.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        wst.permit(alice, spender, value, deadline, v, r, s);
        assertEq(wst.allowance(alice, spender), value, "permit set allowance");
        assertEq(wst.nonces(alice), 1, "nonce consumed");

        // Replaying the same signature must fail (nonce moved).
        vm.expectRevert(WstAETHEL.InvalidSignature.selector);
        wst.permit(alice, spender, value, deadline, v, r, s);
    }

    function test_permit_rejects_expired_deadline() public {
        setUp();
        vm.warp(1000);
        bytes32 digest = keccak256("irrelevant");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);
        vm.expectRevert(WstAETHEL.PermitExpired.selector);
        wst.permit(alice, address(0x5137), 1, 999, v, r, s);
    }
}
