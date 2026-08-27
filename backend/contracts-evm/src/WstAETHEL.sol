// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

interface IStAETHEL {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transferShares(address to, uint256 sharesAmount) external returns (uint256 aethelAmount);
    function sharesOf(address account) external view returns (uint256);
    function getSharesByAethel(uint256 aethelAmount) external view returns (uint256);
    function getAethelByShares(uint256 sharesAmount) external view returns (uint256);
}

/// @title WstAETHEL — wrapped (non-rebasing) stAETHEL
///
/// The wstETH pattern for Aethelred liquid staking. Rebasing balances break
/// AMMs, lending markets, and vault integrations, so WstAETHEL locks
/// stAETHEL and mints a FIXED balance equal to the underlying share count.
/// Balances never rebase; value accrues through the redemption rate
/// (`stAethelPerToken`), which rises as the vault adds rewards.
///
///   wrap(stAmount)  → mints the share-equivalent of stAmount at the current
///                     exchange rate (measured as the wrapper's actual share
///                     delta, so rounding can never mint unbacked wst)
///   unwrap(wstAmount) → returns the CURRENT stAETHEL value of those shares
///
/// Dependency-free by design (house style): the ERC-20 and EIP-2612 permit
/// surfaces are implemented inline rather than through a library import.
contract WstAETHEL {
    // ── errors ───────────────────────────────────────────────────────────
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    error PermitExpired();
    error InvalidSignature();
    error TransferFailed();
    error Reentrancy();

    // ── metadata ─────────────────────────────────────────────────────────
    string public constant name = "Wrapped stAETHEL";
    string public constant symbol = "wstAETHEL";
    uint8 public constant decimals = 18;

    IStAETHEL public immutable stAethel;

    // ── ERC-20 state ─────────────────────────────────────────────────────
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 private locked = 1;

    // ── EIP-2612 state ───────────────────────────────────────────────────
    mapping(address => uint256) public nonces;
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Wrapped(address indexed account, uint256 stAethelAmount, uint256 wstAmount);
    event Unwrapped(address indexed account, uint256 wstAmount, uint256 stAethelAmount);

    constructor(address stAethel_) {
        if (stAethel_ == address(0)) revert ZeroAddress();
        stAethel = IStAETHEL(stAethel_);
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    // ── wrap / unwrap ────────────────────────────────────────────────────

    /// @notice Lock `stAethelAmount` of rebasing stAETHEL, mint fixed wstAETHEL.
    /// @return wstAmount the wst minted — the wrapper's ACTUAL share delta, so
    ///         floor-rounding in the rebasing token can never mint unbacked wst.
    function wrap(uint256 stAethelAmount) external nonReentrant returns (uint256 wstAmount) {
        if (stAethelAmount == 0) revert ZeroAmount();

        uint256 sharesBefore = stAethel.sharesOf(address(this));
        // Reverts inside stAETHEL on missing balance/allowance; the return is
        // also checked so a non-reverting false can never slip through.
        if (!stAethel.transferFrom(msg.sender, address(this), stAethelAmount)) {
            revert TransferFailed();
        }
        wstAmount = stAethel.sharesOf(address(this)) - sharesBefore;
        if (wstAmount == 0) revert ZeroAmount();

        totalSupply += wstAmount;
        balanceOf[msg.sender] += wstAmount;
        emit Transfer(address(0), msg.sender, wstAmount);
        emit Wrapped(msg.sender, stAethelAmount, wstAmount);
    }

    /// @notice Burn `wstAmount`, receive its CURRENT stAETHEL value.
    function unwrap(uint256 wstAmount) external nonReentrant returns (uint256 stAethelAmount) {
        if (wstAmount == 0) revert ZeroAmount();
        uint256 held = balanceOf[msg.sender];
        if (held < wstAmount) revert InsufficientBalance();

        stAethelAmount = stAethel.getAethelByShares(wstAmount);
        if (stAethelAmount == 0) revert ZeroAmount();

        unchecked {
            balanceOf[msg.sender] = held - wstAmount;
        }
        totalSupply -= wstAmount;
        emit Transfer(msg.sender, address(0), wstAmount);

        // CRZ-01: check the return — unwrap has already burned the wst, so a
        // silent-false transfer would otherwise leave the user with neither.
        uint256 transferredAmount = stAethel.transferShares(msg.sender, wstAmount);
        if (transferredAmount != stAethelAmount) revert TransferFailed();
        emit Unwrapped(msg.sender, wstAmount, stAethelAmount);
    }

    // ── redemption views ─────────────────────────────────────────────────

    /// @notice Current stAETHEL value of 1e18 wstAETHEL.
    function stAethelPerToken() external view returns (uint256) {
        return stAethel.getAethelByShares(1e18);
    }

    /// @notice Current wstAETHEL equivalent of 1e18 stAETHEL.
    function tokensPerStAethel() external view returns (uint256) {
        return stAethel.getSharesByAethel(1e18);
    }

    // ── ERC-20 ───────────────────────────────────────────────────────────

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 held = balanceOf[from];
        if (held < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = held - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        if (spender == address(0)) revert ZeroAddress();
        allowance[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    // ── EIP-2612 permit ──────────────────────────────────────────────────

    /// @notice Domain separator, computed live so a chain fork can never
    ///         replay signatures across chain ids.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (block.timestamp > deadline) revert PermitExpired();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != owner) revert InvalidSignature();

        _approve(owner, spender, value);
    }
}
