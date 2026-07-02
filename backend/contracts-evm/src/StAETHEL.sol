// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

/// @title stAETHEL — Cruzible's rebasing liquid staking token
/// @notice Lido-style rebasing ERC-20: an account's balance is the AETHEL
///         value of its underlying shares, so balances grow as staking
///         rewards accrue to the pool. Shares are the invariant unit;
///         `balanceOf` = shares × exchange-rate.
/// @dev    The share ledger lives here; ONLY the Cruzible vault may mint and
///         burn shares. The vault is the source of truth for
///         `totalPooledAethel` (pool accounting), queried on every balance
///         computation — one accounting source, no drift.
interface ICruziblePool {
    function totalPooledAethel() external view returns (uint256);
}

contract StAETHEL {
    string public constant name = "Staked AETHEL";
    string public constant symbol = "stAETHEL";
    uint8 public constant decimals = 18;

    /// @notice The Cruzible vault: exclusive minter/burner and pool oracle.
    address public immutable vault;

    uint256 private _totalShares;
    mapping(address => uint256) private _shares;
    mapping(address => mapping(address => uint256)) private _allowances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    /// @notice Emitted alongside Transfer for share-level accounting.
    event TransferShares(address indexed from, address indexed to, uint256 sharesValue);

    error OnlyVault();
    error ZeroAddress();
    error InsufficientShares();
    error InsufficientAllowance();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address _vault) {
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
    }

    // ── share accounting (vault-only) ────────────────────────────────────────

    /// @notice Mint shares to an account (vault-only, on stake).
    function mintShares(address to, uint256 sharesAmount) external onlyVault {
        if (to == address(0)) revert ZeroAddress();
        _totalShares += sharesAmount;
        _shares[to] += sharesAmount;
        emit Transfer(address(0), to, getAethelByShares(sharesAmount));
        emit TransferShares(address(0), to, sharesAmount);
    }

    /// @notice Burn shares from an account (vault-only, on unstake).
    function burnShares(address from, uint256 sharesAmount) external onlyVault {
        uint256 held = _shares[from];
        if (held < sharesAmount) revert InsufficientShares();
        unchecked {
            _shares[from] = held - sharesAmount;
            _totalShares -= sharesAmount;
        }
        emit Transfer(from, address(0), getAethelByShares(sharesAmount));
        emit TransferShares(from, address(0), sharesAmount);
    }

    // ── rebasing views ───────────────────────────────────────────────────────

    /// @notice AETHEL value of an account's shares (the rebasing balance).
    function balanceOf(address account) external view returns (uint256) {
        return getAethelByShares(_shares[account]);
    }

    /// @notice Raw share balance of an account.
    function sharesOf(address account) external view returns (uint256) {
        return _shares[account];
    }

    /// @notice Total AETHEL represented by all shares.
    function totalSupply() external view returns (uint256) {
        return ICruziblePool(vault).totalPooledAethel();
    }

    /// @notice Total shares in existence.
    function getTotalShares() external view returns (uint256) {
        return _totalShares;
    }

    /// @notice Convert an AETHEL amount to shares at the current rate.
    function getSharesByAethel(uint256 aethelAmount) public view returns (uint256) {
        uint256 pooled = ICruziblePool(vault).totalPooledAethel();
        if (pooled == 0 || _totalShares == 0) {
            // Bootstrap: 1 share per aethel.
            return aethelAmount;
        }
        return (aethelAmount * _totalShares) / pooled;
    }

    /// @notice Convert shares to their AETHEL value at the current rate.
    function getAethelByShares(uint256 sharesAmount) public view returns (uint256) {
        if (_totalShares == 0) return 0;
        return (sharesAmount * ICruziblePool(vault).totalPooledAethel()) / _totalShares;
    }

    /// @notice AETHEL per 1e18 shares (the exchange rate, 18 decimals).
    function getExchangeRate() external view returns (uint256) {
        if (_totalShares == 0) return 1e18;
        return (ICruziblePool(vault).totalPooledAethel() * 1e18) / _totalShares;
    }

    // ── ERC-20 transfer surface (share-based under the hood) ────────────────

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            unchecked {
                _allowances[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 sharesToMove = getSharesByAethel(amount);
        uint256 held = _shares[from];
        if (held < sharesToMove) revert InsufficientShares();
        unchecked {
            _shares[from] = held - sharesToMove;
        }
        _shares[to] += sharesToMove;
        emit Transfer(from, to, amount);
        emit TransferShares(from, to, sharesToMove);
    }
}
