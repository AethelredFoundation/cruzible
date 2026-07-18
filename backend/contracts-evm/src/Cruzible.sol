// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

import "./interfaces/ISeal.sol";

interface IStAETHEL {
    function mintShares(address to, uint256 sharesAmount) external;
    function mintBootstrapShares(address lockAddress, address to, uint256 lockedShares, uint256 userShares) external;
    function burnShares(address from, uint256 sharesAmount) external;
    function getSharesByAethel(uint256 aethelAmount) external view returns (uint256);
    function getAethelByShares(uint256 sharesAmount) external view returns (uint256);
    function getTotalShares() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/// @title Cruzible — compliance-native liquid staking for Aethelred
/// @notice Stake native AETHEL, receive rebasing stAETHEL. Built for
///         sovereign and regulated institutions:
///
///         1. **Seal-gated entry (unique to Aethelred).** When compliance
///            mode is on, `stake()` requires an ACTIVE Digital Seal whose
///            PoUW job was run for exactly this staker (the seal's purpose
///            binds `cruzible-stake:0x<address>`) and whose confidentiality
///            attestation satisfies the vault's policy (jurisdiction,
///            backend, vendor-root) — evaluated by the ISeal precompile at
///            0x0900, i.e. by the SAME consensus logic that minted the seal.
///            No allowlist oracle, no off-chain KYC server in the trust path.
///         2. **Transparent exchange-rate accounting.** One pool variable
///            (`totalPooledAethel`), share math in the open, per-epoch rate
///            checkpoints so APY is COMPUTED from on-chain history — never an
///            operator-typed number.
///         3. **Bounded exit liquidity.** Unbonding-delayed withdrawal queue
///            mirroring the chain's unbonding period; funds for claims are
///            reserved at request time so a queue can never be diluted.
///         4. **Merkle rewards.** Off-protocol reward programs (points,
///            incentives) settle through per-epoch Merkle roots — claims are
///            proof-verified on-chain.
///
/// @dev    Native-token design: no wrapped/ERC-20 AETHEL in the trust path
///         (one less depeg/approval surface). Checks-effects-interactions
///         throughout; explicit reentrancy guard on native transfers.
/// @dev cosmos/evm staking precompile surface (0x0800). Amounts in the bond
///      denom's base units (uaethel, 6 decimals).
interface IStakingPrecompile {
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

    function delegate(address delegatorAddress, string calldata validatorAddress, uint256 amount)
        external
        returns (bool success);

    function undelegate(address delegatorAddress, string calldata validatorAddress, uint256 amount)
        external
        returns (int64 completionTime);

    /// @dev Returns zero values (not a revert) when no delegation exists.
    function delegation(address delegatorAddress, string calldata validatorAddress)
        external
        view
        returns (uint256 shares, Coin memory balance);

    /// @dev Returns an empty entries array when nothing is unbonding. Matured
    ///      entries are removed by the chain at end-of-block; `balance`
    ///      reflects any slashing applied while unbonding.
    function unbondingDelegation(address delegatorAddress, string calldata validatorAddress)
        external
        view
        returns (UnbondingDelegationOutput memory unbondingDelegation);
}

/// @dev ZeroID identity registry surface (the zeroid repo's ZeroID.sol):
///      Aethelred's default identity layer. resolveByController returns the
///      DID hash bound to a wallet (zero if none); isActiveIdentity reflects
///      live status — suspension/revocation in ZeroID immediately closes the
///      gate here, with no cache to go stale.
interface IZeroIDRegistry {
    function resolveByController(address controller) external view returns (bytes32 didHash);

    function isActiveIdentity(bytes32 didHash) external view returns (bool);
}

/// @dev cosmos/evm distribution precompile surface (0x0801).
interface IDistributionPrecompile {
    struct Coin {
        string denom;
        uint256 amount;
    }

    function withdrawDelegatorRewards(address delegatorAddress, string calldata validatorAddress)
        external
        returns (Coin[] memory amount);
}

contract Cruzible {
    // ── roles ────────────────────────────────────────────────────────────────

    /// @notice Governance: parameter/policy changes, role rotation. Expected to
    ///         be a timelock (and/or multisig) so stakers see sensitive changes
    ///         in advance and can exit — see docs/SECURITY.md.
    address public governance;
    /// @notice Nominated successor governance, pending acceptance (two-step).
    address public pendingGovernance;
    /// @notice Rewarder: routes staking rewards into the pool, posts Merkle roots.
    address public rewarder;
    /// @notice Pauser: emergency stop for deposits (never for withdrawals).
    address public pauser;

    // ── pool accounting ──────────────────────────────────────────────────────

    /// @notice Total AETHEL under management (staked principal + accrued rewards
    ///         − amounts reserved for the withdrawal queue).
    uint256 public totalPooledAethel;
    /// @notice Catastrophic asset shortfall that could not be socialized
    ///         against active stAETHEL holders. New stakes and queued claims
    ///         fail closed until an explicit recapitalization clears it.
    uint256 public uncoveredDeficit;
    /// @notice AETHEL reserved for requested-but-unclaimed withdrawals.
    uint256 public totalReserved;

    IStAETHEL public stAethel;

    // ── epochs & rate history (for computed APY) ─────────────────────────────

    uint256 public currentEpoch;
    /// @dev exchange rate (1e18) checkpointed at each epoch advance.
    mapping(uint256 => uint256) public epochRate;
    mapping(uint256 => uint256) public epochTime;

    // ── withdrawal queue ─────────────────────────────────────────────────────

    struct Withdrawal {
        uint256 id;
        uint256 shares;
        uint256 aethelAmount;
        uint256 requestTime;
        uint256 completionTime;
        bool claimed;
    }

    /// @notice Unbonding delay before a requested withdrawal is claimable.
    uint256 public unbondingPeriod;
    uint256 private nextWithdrawalId;
    mapping(address => Withdrawal[]) private userWithdrawals;
    /// @dev id → (owner, index+1) for O(1) claim lookup; 0 = unknown.
    mapping(uint256 => address) private withdrawalOwner;
    mapping(uint256 => uint256) private withdrawalIndexPlus1;

    // ── Merkle rewards ───────────────────────────────────────────────────────

    mapping(uint256 => bytes32) public rewardsRoot; // epoch → root
    mapping(uint256 => mapping(address => bool)) public rewardsClaimed;
    /// @notice Segregated funding for Merkle reward programs. Claims can ONLY
    ///         draw from this reserve — staked principal and the withdrawal
    ///         queue are never reachable by a rewards claim.
    uint256 public merkleReserve;

    // ── native staking surface (Phase-2 real yield) ──────────────────────────

    /// @dev cosmos/evm staking precompile: delegate/undelegate pooled AETHEL.
    ///      AMOUNTS ARE IN THE BOND DENOM'S BASE UNITS (uaethel, 6 decimals) —
    ///      the vault converts from its 18-decimal accounting via
    ///      DECIMAL_BRIDGE before every call.
    IStakingPrecompile internal constant STAKING = IStakingPrecompile(0x0000000000000000000000000000000000000800);
    /// @dev cosmos/evm distribution precompile: withdraw EARNED staking
    ///      rewards; the chain credits them to the vault's native balance.
    IDistributionPrecompile internal constant DISTRIBUTION =
        IDistributionPrecompile(0x0000000000000000000000000000000000000801);
    /// @dev x/precisebank bridges 6-decimal uaethel ↔ 18-decimal EVM units.
    uint256 internal constant DECIMAL_BRIDGE = 1e12;

    /// @notice Pooled AETHEL currently delegated to validators, in the same
    ///         18-decimal units as totalPooledAethel. Delegated funds remain
    ///         stakers' claim (inside totalPooledAethel) but leave the native
    ///         balance — the free buffer shrinks accordingly.
    uint256 public totalDelegated;
    /// @notice Bonded principal per validator (18-decimal). Reconciled against
    ///         the chain's own delegation record by {reconcileValidator}.
    mapping(string => uint256) public delegatedTo;

    /// @notice Pooled AETHEL in flight back to the vault: undelegated but not
    ///         yet paid out by the chain's unbonding queue (18-decimal).
    ///         Counts as coverage for the withdrawal queue — see queueDeficit.
    uint256 public totalUnbonding;
    /// @notice In-flight unbonding per validator (18-decimal).
    mapping(string => uint256) public unbondingFrom;

    /// @dev The vault's own record of each undelegation, FIFO per validator.
    ///      completionTime comes from the chain (the precompile's return
    ///      value); {syncUndelegations} pops matured entries. Slashing while
    ///      unbonding is reconciled against the chain's entries — aggregates,
    ///      not per-entry, because the chain merges same-height entries.
    struct PendingUndelegation {
        uint256 amountWei;
        uint256 completionTime;
    }

    mapping(string => PendingUndelegation[]) internal pendingUndelegations;
    mapping(string => uint256) internal pendingHead;

    // ── compliance gate (the Aethelred moat) ─────────────────────────────────

    ISeal internal constant SEAL = ISeal(0x0000000000000000000000000000000000000900);

    /// @notice When true, stake() requires a policy-satisfying Digital Seal.
    bool public complianceRequired;
    /// @notice CEAP policy the staker's seal must satisfy (empty arrays = any).
    string[] public policyAllowedBackends;
    string public policyMinVerification;
    string[] public policyAllowedPlatforms;
    bool public policyRequireVendorRoot;
    string[] public policyDataResidency;
    /// @dev A seal authorizes exactly one stake entry (replay protection).
    mapping(string => bool) public sealUsed;
    /// @notice Stakers admitted through the compliance gate.
    mapping(address => bool) public complianceAdmitted;

    // ── identity gate (ZeroID — the Aethelred identity layer) ────────────────

    /// @notice When set and required, every stake entry additionally demands a
    ///         registered, ACTIVE ZeroID identity for the staker. Checked live
    ///         on every stake (never cached), so a suspension or revocation in
    ///         ZeroID blocks new stakes immediately. Exits are NEVER
    ///         identity-gated — a revoked identity can always leave.
    IZeroIDRegistry public identityRegistry;
    /// @notice Whether the identity gate is enforced.
    bool public identityRequired;

    // ── rate guard + instant exit (Phase-1 economic security) ────────────────

    /// @notice Max exchange-rate rebase a single addRewards report may cause,
    ///         in basis points of the current pool. Bounds the rewarder key:
    ///         even a compromised key cannot move the rate arbitrarily in one
    ///         transaction (Lido-style oracle sanity check). Hard cap 20%.
    uint256 public maxRebaseBps = 500;
    /// @notice Minimum seconds between reward reports. Floor 10 minutes.
    uint256 public minRewardInterval = 1 hours;
    /// @notice Timestamp of the last accepted reward report.
    uint256 public lastRewardsAt;

    /// @notice Fee on instant exits, in basis points. The fee REMAINS in the
    ///         pool, rebasing every remaining holder upward. Hard cap 2%;
    ///         raises are additionally step-bounded (max +50 bps per action)
    ///         so a governance action cannot jump the fee on in-flight users.
    uint256 public instantExitFeeBps = 50;
    /// @dev Maximum fee increase a single governance action may apply.
    uint256 internal constant MAX_FEE_RAISE_STEP_BPS = 50;

    // ── in-contract economic limits (0 = disabled) ───────────────────────────

    /// @notice TVL cap: staking that would push totalPooledAethel above this
    ///         reverts. For staged rollouts (canary limits). Never gates exits.
    uint256 public maxTotalPooled;
    /// @notice Per-account cap on the resulting stAETHEL balance after a stake.
    uint256 public maxStakePerAccount;
    /// @notice Per-validator delegation cap, in bps of totalPooledAethel.
    uint256 public maxValidatorBps;
    /// @notice Minimum share of the pool that must remain liquid (native
    ///         balance) after any delegation, in bps of totalPooledAethel.
    uint256 public minBufferBps;
    /// @dev Bound on batchWithdraw fan-out per call (keeper-work bound).
    uint256 public constant MAX_BATCH_WITHDRAW = 100;
    /// @dev Bound on matured-FIFO entries processed per sync call: progress is
    ///      monotonic and the function is callable repeatedly, so no queue
    ///      length can make it permanently uncallable.
    uint256 internal constant MAX_SYNC_PER_CALL = 64;

    // ── misc ─────────────────────────────────────────────────────────────────

    bool public depositsPaused;
    uint256 private locked = 1; // reentrancy guard

    /// @notice Shares permanently locked on the first stake so the exchange
    ///         rate can never be manipulated back to the 1-wei bootstrap regime.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    /// @dev Burn address holding the locked bootstrap shares.
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ── events ───────────────────────────────────────────────────────────────

    event Staked(address indexed user, uint256 amount, uint256 shares);
    event Unstaked(address indexed user, uint256 shares, uint256 amount, uint256 withdrawalId, uint256 completionTime);
    event InstantUnstaked(address indexed user, uint256 shares, uint256 amountPaid, uint256 fee);
    event Delegated(string validator, uint256 amountWei);
    event Undelegated(string validator, uint256 amountWei, int64 completionTime);
    event QueueUndelegated(string validator, uint256 amountWei, address indexed caller);
    event UndelegationsMatured(string validator, uint256 amountWei);
    event SlashingRealized(string validator, uint256 lossWei, uint256 newTotalPooled);
    event CatastrophicInsolvency(string validator, uint256 uncoveredDeficit);
    event Recapitalized(address indexed contributor, uint256 amount, uint256 remainingDeficit);
    event RealYieldClaimed(string validator, uint256 amountWei, uint256 newTotalPooled);
    event RateGuardSet(uint256 maxRebaseBps, uint256 minRewardInterval);
    event InstantExitFeeSet(uint256 feeBps);
    event EconomicLimitsSet(
        uint256 maxTotalPooled, uint256 maxStakePerAccount, uint256 maxValidatorBps, uint256 minBufferBps
    );
    event Withdrawn(address indexed user, uint256 withdrawalId, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 indexed epoch, uint256 amount);
    event RewardsAdded(uint256 amount, uint256 newTotalPooled);
    event EpochAdvanced(uint256 indexed epoch, uint256 exchangeRate);
    event RewardsRootSet(uint256 indexed epoch, bytes32 root);
    event ComplianceModeSet(bool required);
    event CompliancePolicySet(
        string[] allowedBackends,
        string minVerification,
        string[] allowedPlatforms,
        bool requireVendorRoot,
        string[] dataResidency
    );
    event ComplianceAdmitted(address indexed staker, string sealId, string jobId);
    event IdentityGateSet(address registry, bool required);
    event DepositsPausedSet(bool paused);
    event RoleSet(bytes32 indexed role, address account);
    event GovernanceTransferStarted(address indexed from, address indexed to);

    // ── errors ───────────────────────────────────────────────────────────────

    error NotGovernance();
    error NotPendingGovernance();
    error NotRewarder();
    error NotPauser();
    error ZeroAmount();
    error ZeroAddress();
    error StakeTooSmall();
    error DepositsArePaused();
    error TokenAlreadySet();
    error TokenNotSet();
    error InsufficientPool();
    error UnknownWithdrawal();
    error NotWithdrawalOwner();
    error AlreadyClaimed();
    error NotYetClaimable();
    error Reentrancy();
    error RebaseTooLarge();
    error RewardsTooFrequent();
    error InsufficientBuffer();
    error SlippageExceeded();
    error MinimumSharesNotMet(uint256 minimumShares, uint256 actualShares);
    error MinimumAethelNotMet(uint256 minimumAethel, uint256 actualAethel);
    error BadParam();
    error DelegationFailed();
    error NoQueueDeficit();
    error TvlCapExceeded();
    error AccountCapExceeded();
    error ValidatorConcentrationExceeded();
    error BufferPolicyViolated();
    error BatchTooLarge();
    error ComplianceGateClosed(string reason);
    error IdentityGateClosed(string reason);
    error SealAlreadyUsed(string sealId);
    error SealNotActive(string sealId);
    error SealNotBoundToStaker(string expectedPurpose);
    error RewardsProofInvalid();
    error RootNotSet(uint256 epoch);
    error ProtocolInsolvent(uint256 uncoveredDeficit);

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }
    modifier onlyRewarder() {
        if (msg.sender != rewarder) revert NotRewarder();
        _;
    }
    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address _governance, address _rewarder, address _pauser, uint256 _unbondingPeriod) {
        if (_governance == address(0) || _rewarder == address(0) || _pauser == address(0)) {
            revert ZeroAddress();
        }
        governance = _governance;
        rewarder = _rewarder;
        pauser = _pauser;
        unbondingPeriod = _unbondingPeriod;
        epochRate[0] = 1e18;
        epochTime[0] = block.timestamp;
    }

    /// @notice One-time wiring of the stAETHEL token (deployed after the vault
    ///         since the token needs the vault address as immutable minter).
    function setStAethel(address token) external onlyGovernance {
        if (address(stAethel) != address(0)) revert TokenAlreadySet();
        if (token == address(0)) revert ZeroAddress();
        stAethel = IStAETHEL(token);
    }

    // ── staking ──────────────────────────────────────────────────────────────

    /// @notice Stake native AETHEL; receive rebasing stAETHEL shares. When
    ///         compliance mode is on, the caller must have been admitted via
    ///         {stakeWithSeal} (or governance policy change).
    function stake() public payable returns (uint256 shares) {
        return _stake(msg.sender, msg.value, 0);
    }

    /// @notice Stake native AETHEL while requiring at least `minShares` to be
    ///         minted. The bound is checked atomically against the execution
    ///         rate, preventing a quote from becoming stale before inclusion.
    function stakeWithMinShares(uint256 minShares) external payable returns (uint256 shares) {
        return _stake(msg.sender, msg.value, minShares);
    }

    /// @notice Stake with a referral code (tracked off-protocol via the event
    ///         log; the code has no effect on share accounting).
    function stakeWithReferral(uint256 referralCode) external payable returns (uint256 shares) {
        shares = _stake(msg.sender, msg.value, 0);
        emit ReferralRecorded(msg.sender, referralCode, msg.value);
    }

    event ReferralRecorded(address indexed user, uint256 indexed referralCode, uint256 amount);

    /// @notice Compliance entry: present the Digital Seal minted by the PoUW
    ///         compliance job that was run for THIS staker. On success the
    ///         staker is admitted and the stake executes atomically.
    /// @param jobId The PoUW job whose seal authorizes this staker.
    function stakeWithSeal(string calldata jobId) external payable returns (uint256 shares) {
        _admitWithSeal(msg.sender, jobId);
        return _stake(msg.sender, msg.value, 0);
    }

    /// @notice Compliance entry with the same atomic minimum-share bound as
    ///         {stakeWithMinShares}. Seal admission and staking either both
    ///         succeed or both revert.
    function stakeWithSealAndMinShares(string calldata jobId, uint256 minShares)
        external
        payable
        returns (uint256 shares)
    {
        _admitWithSeal(msg.sender, jobId);
        return _stake(msg.sender, msg.value, minShares);
    }

    function _stake(address staker, uint256 amount, uint256 minShares) internal nonReentrant returns (uint256 shares) {
        if (address(stAethel) == address(0)) revert TokenNotSet();
        if (amount == 0) revert ZeroAmount();
        if (uncoveredDeficit != 0) revert ProtocolInsolvent(uncoveredDeficit);
        if (depositsPaused) revert DepositsArePaused();
        if (identityRequired) {
            bytes32 did = identityRegistry.resolveByController(staker);
            if (did == bytes32(0)) {
                revert IdentityGateClosed("no ZeroID identity registered for staker");
            }
            if (!identityRegistry.isActiveIdentity(did)) {
                revert IdentityGateClosed("ZeroID identity is not active");
            }
        }
        if (complianceRequired && !complianceAdmitted[staker]) {
            revert ComplianceGateClosed("staker not admitted: present a Digital Seal via stakeWithSeal");
        }
        // In-contract economic limits (0 = disabled). Enforced on ENTRY only —
        // exits are never gated by any limit.
        if (maxTotalPooled != 0 && totalPooledAethel + amount > maxTotalPooled) {
            revert TvlCapExceeded();
        }
        if (maxStakePerAccount != 0 && stAethel.balanceOf(staker) + amount > maxStakePerAccount) {
            revert AccountCapExceeded();
        }

        // Shares at the CURRENT rate (before adding the new deposit).
        shares = stAethel.getSharesByAethel(amount);

        // First-depositor / share-inflation defense. Donation-inflation is
        // already impossible here (the exchange rate reads the explicit
        // totalPooledAethel accumulator, never address(this).balance, so a
        // force-sent transfer cannot move the rate). This guards the remaining
        // vector — legitimate rewards accruing before a tiny deposit could round
        // its shares to 0, letting the pool absorb funds for no stAETHEL:
        //   - bootstrap: permanently lock MINIMUM_LIQUIDITY shares to a dead
        //     address (Uniswap-V2 / OZ-ERC4626 pattern) so totalShares can never
        //     return to the pathological 1-wei regime;
        //   - every stake: reject deposits that would mint 0 shares.
        totalPooledAethel += amount;
        bool isBootstrap = stAethel.getTotalShares() == 0;
        if (isBootstrap) {
            if (shares <= MINIMUM_LIQUIDITY) revert StakeTooSmall();
            shares -= MINIMUM_LIQUIDITY;
        } else if (shares == 0) {
            revert StakeTooSmall();
        }
        if (shares < minShares) revert MinimumSharesNotMet(minShares, shares);
        if (isBootstrap) {
            stAethel.mintBootstrapShares(DEAD, staker, MINIMUM_LIQUIDITY, shares);
        } else {
            stAethel.mintShares(staker, shares);
        }

        emit Staked(staker, amount, shares);
    }

    // ── compliance gate ──────────────────────────────────────────────────────

    function _admitWithSeal(address staker, string calldata jobId) internal {
        if (complianceAdmitted[staker]) return; // idempotent

        // Resolve the seal for the compliance job (reverts if job unsealed).
        string memory sealId = SEAL.getSealIdByJob(jobId);
        if (sealUsed[sealId]) revert SealAlreadyUsed(sealId);
        if (!SEAL.verifySeal(sealId)) revert SealNotActive(sealId);

        // The seal must have been minted FOR this staker: the PoUW job's
        // purpose binds the staker address (set at submit-job time), so a
        // compliance attestation cannot be replayed for someone else.
        (,,,,,, string memory purpose,,) = SEAL.getSeal(sealId);
        string memory expected = string.concat("cruzible-stake:", _toHexString(staker));
        if (keccak256(bytes(purpose)) != keccak256(bytes(expected))) {
            revert SealNotBoundToStaker(expected);
        }

        // CEAP policy check — consensus-parity Satisfies via the precompile.
        (bool ok, string memory reason) = SEAL.requireConfidentiality(
            sealId,
            policyAllowedBackends,
            policyMinVerification,
            policyAllowedPlatforms,
            policyRequireVendorRoot,
            policyDataResidency
        );
        if (!ok) revert ComplianceGateClosed(reason);

        sealUsed[sealId] = true;
        complianceAdmitted[staker] = true;
        emit ComplianceAdmitted(staker, sealId, jobId);
    }

    /// @notice Governance sets whether staking requires seal admission.
    function setComplianceRequired(bool required) external onlyGovernance {
        complianceRequired = required;
        emit ComplianceModeSet(required);
    }

    /// @notice Governance wires the ZeroID identity registry and turns the
    ///         identity gate on or off. The two admission layers compose:
    ///         ZeroID answers "WHO is staking" (persistent, revocable
    ///         identity), the Digital Seal answers "was THIS entry cleared"
    ///         (per-job compliance attestation) — either or both can be on.
    function setIdentityGate(address registry, bool required) external onlyGovernance {
        if (required && registry == address(0)) revert BadParam();
        identityRegistry = IZeroIDRegistry(registry);
        identityRequired = required;
        emit IdentityGateSet(registry, required);
    }

    /// @notice Whether `staker` currently passes the identity gate — the
    ///         single call the frontend needs for its verification chip.
    ///         True when the gate is off (nothing to verify against).
    function isIdentityVerified(address staker) external view returns (bool) {
        if (!identityRequired) return true;
        bytes32 did = identityRegistry.resolveByController(staker);
        return did != bytes32(0) && identityRegistry.isActiveIdentity(did);
    }

    /// @notice Governance sets the CEAP policy staker seals must satisfy.
    function setCompliancePolicy(
        string[] calldata allowedBackends,
        string calldata minVerification,
        string[] calldata allowedPlatforms,
        bool requireVendorRoot,
        string[] calldata dataResidency
    ) external onlyGovernance {
        policyAllowedBackends = allowedBackends;
        policyMinVerification = minVerification;
        policyAllowedPlatforms = allowedPlatforms;
        policyRequireVendorRoot = requireVendorRoot;
        policyDataResidency = dataResidency;
        emit CompliancePolicySet(allowedBackends, minVerification, allowedPlatforms, requireVendorRoot, dataResidency);
    }

    // ── unstaking / withdrawal queue ─────────────────────────────────────────

    /// @notice Burn stAETHEL shares and enter the unbonding queue. The AETHEL
    ///         value is fixed at request time and RESERVED — later rate moves
    ///         cannot dilute a queued exit, and queued exits cannot dilute
    ///         remaining stakers.
    function unstake(uint256 shares) external returns (uint256 withdrawalId, uint256 aethelAmount) {
        return _unstake(msg.sender, shares, 0);
    }

    /// @notice Burn shares and queue an exit only if the execution-time value
    ///         is at least `minAethel`. This protects delayed exits from quote
    ///         movement between UI preflight and transaction inclusion.
    function unstakeWithMinAethel(uint256 shares, uint256 minAethel)
        external
        returns (uint256 withdrawalId, uint256 aethelAmount)
    {
        return _unstake(msg.sender, shares, minAethel);
    }

    function _unstake(address staker, uint256 shares, uint256 minAethel)
        internal
        nonReentrant
        returns (uint256 withdrawalId, uint256 aethelAmount)
    {
        if (address(stAethel) == address(0)) revert TokenNotSet();
        if (shares == 0) revert ZeroAmount();

        aethelAmount = stAethel.getAethelByShares(shares);
        if (aethelAmount == 0) revert ZeroAmount();
        if (aethelAmount > totalPooledAethel) revert InsufficientPool();
        if (aethelAmount < minAethel) revert MinimumAethelNotMet(minAethel, aethelAmount);

        stAethel.burnShares(staker, shares);
        totalPooledAethel -= aethelAmount;
        totalReserved += aethelAmount;

        withdrawalId = ++nextWithdrawalId;
        userWithdrawals[staker].push(
            Withdrawal({
                id: withdrawalId,
                shares: shares,
                aethelAmount: aethelAmount,
                requestTime: block.timestamp,
                completionTime: block.timestamp + unbondingPeriod,
                claimed: false
            })
        );
        withdrawalOwner[withdrawalId] = staker;
        withdrawalIndexPlus1[withdrawalId] = userWithdrawals[staker].length;

        emit Unstaked(staker, shares, aethelAmount, withdrawalId, block.timestamp + unbondingPeriod);
    }

    /// @notice Exit immediately from the vault's free buffer, paying the
    ///         instant-exit fee instead of waiting out the unbonding queue.
    ///
    ///         The free buffer is the vault's native balance minus every
    ///         queued-withdrawal reservation and the segregated Merkle
    ///         reserve — instant exits can never touch funds already promised
    ///         to the queue or to reward programs. The fee stays in the pool,
    ///         so every remaining holder rebases upward.
    /// @param shares  stAETHEL shares to burn.
    /// @param minOut  Slippage guard on the paid amount (post-fee).
    function instantUnstake(uint256 shares, uint256 minOut) external nonReentrant returns (uint256 amountPaid) {
        if (address(stAethel) == address(0)) revert TokenNotSet();
        if (shares == 0) revert ZeroAmount();

        uint256 aethelAmount = stAethel.getAethelByShares(shares);
        if (aethelAmount == 0) revert ZeroAmount();
        if (aethelAmount > totalPooledAethel) revert InsufficientPool();

        uint256 fee = (aethelAmount * instantExitFeeBps) / 10_000;
        amountPaid = aethelAmount - fee;
        if (amountPaid < minOut) revert SlippageExceeded();
        if (amountPaid > freeBuffer()) revert InsufficientBuffer();

        stAethel.burnShares(msg.sender, shares);
        // Only the PAID amount leaves the pool: the fee remains inside
        // totalPooledAethel with fewer shares outstanding — a pro-rata
        // rebase to everyone still staked.
        totalPooledAethel -= amountPaid;

        emit InstantUnstaked(msg.sender, shares, amountPaid, fee);

        (bool sent,) = payable(msg.sender).call{value: amountPaid}("");
        require(sent, "transfer failed");
    }

    /// @notice Native balance not promised to the withdrawal queue or the
    ///         Merkle reward reserve — the only funds instant exits (and new
    ///         delegations) may use.
    function freeBuffer() public view returns (uint256) {
        uint256 promised = totalReserved + merkleReserve;
        uint256 balance = address(this).balance;
        return balance > promised ? balance - promised : 0;
    }

    // ── Phase-2 real yield: delegate pooled AETHEL, claim EARNED rewards ─────

    /// @notice Delegate pooled AETHEL to a validator through the chain's
    ///         staking precompile. The delegated amount remains the stakers'
    ///         claim (totalPooledAethel is unchanged) but leaves the native
    ///         balance — x/staking now holds it and it earns REAL rewards.
    ///         Governance-operated during the rollout; queue and Merkle
    ///         reservations are never delegatable.
    /// @param validator  Bech32 valoper address.
    /// @param amountWei  18-decimal amount; must be a whole uaethel multiple
    ///                   (the 1e12 bridge would silently drop dust otherwise).
    function delegateToValidator(string calldata validator, uint256 amountWei) external onlyGovernance nonReentrant {
        if (amountWei == 0 || amountWei % DECIMAL_BRIDGE != 0) revert BadParam();
        if (amountWei > freeBuffer()) revert InsufficientBuffer();
        // In-contract delegation limits (0 = disabled): per-validator
        // concentration cap and a minimum-liquid-buffer policy, both in bps
        // of the pool.
        if (maxValidatorBps != 0 && (delegatedTo[validator] + amountWei) * 10_000 > totalPooledAethel * maxValidatorBps)
        {
            revert ValidatorConcentrationExceeded();
        }
        if (minBufferBps != 0 && (freeBuffer() - amountWei) * 10_000 < totalPooledAethel * minBufferBps) {
            revert BufferPolicyViolated();
        }

        totalDelegated += amountWei;
        delegatedTo[validator] += amountWei;
        bool ok = STAKING.delegate(address(this), validator, amountWei / DECIMAL_BRIDGE);
        if (!ok) revert DelegationFailed();
        emit Delegated(validator, amountWei);
    }

    /// @notice Begin undelegating from a validator. The funds return to the
    ///         vault's native balance automatically once the chain's
    ///         unbonding period completes (x/staking pays out — no claim tx).
    function undelegateFromValidator(string calldata validator, uint256 amountWei)
        external
        onlyGovernance
        nonReentrant
        returns (int64 completionTime)
    {
        if (amountWei == 0 || amountWei % DECIMAL_BRIDGE != 0) revert BadParam();
        if (amountWei > delegatedTo[validator]) revert BadParam();

        completionTime = _undelegate(validator, amountWei);
    }

    /// @notice Cover the withdrawal queue from delegated funds: undelegates
    ///         exactly the queue's uncovered deficit (rounded up to a whole
    ///         uaethel), capped by what is delegated to `validator`.
    ///         PERMISSIONLESS — the amount is COMPUTED from the deficit, not
    ///         caller-chosen, and it can only move funds from a validator back
    ///         toward stakers who are already owed them; a keeper or a queued
    ///         withdrawer can call it. This closes the operational gap between
    ///         queued exits and real chain undelegations.
    function undelegateForQueue(string calldata validator) external nonReentrant returns (uint256 amountWei) {
        _syncUndelegations(validator);

        uint256 deficit = queueDeficit();
        if (deficit == 0) revert NoQueueDeficit();

        // Round UP to a whole uaethel so a dusty deficit is fully coverable.
        amountWei = ((deficit + DECIMAL_BRIDGE - 1) / DECIMAL_BRIDGE) * DECIMAL_BRIDGE;
        uint256 available = delegatedTo[validator];
        if (available == 0) revert BadParam();
        if (amountWei > available) amountWei = available; // partial cover

        _undelegate(validator, amountWei);
        emit QueueUndelegated(validator, amountWei, msg.sender);
    }

    /// @notice Pop this validator's matured undelegations from the vault's
    ///         FIFO: the chain has paid those funds into the vault's balance,
    ///         so they stop counting as in-flight coverage. Permissionless.
    function syncUndelegations(string calldata validator) external returns (uint256 maturedWei) {
        return _syncUndelegations(validator);
    }

    /// @notice Realize slashing losses against consensus truth. Compares the
    ///         vault's recorded bonded and in-flight-unbonding amounts with
    ///         the staking precompile's own state and socializes any shortfall
    ///         across the pool — every holder rebases down pro-rata (the
    ///         incumbent model) instead of the last exiters absorbing the
    ///         whole loss. PERMISSIONLESS: it reads chain state and can only
    ///         mark the rate DOWN to reality, never up.
    function reconcileValidator(string calldata validator) external nonReentrant returns (uint256 lossWei) {
        _syncUndelegations(validator);

        // Bonded principal vs the chain's delegation record.
        uint256 recordedBonded = delegatedTo[validator];
        if (recordedBonded > 0) {
            (, IStakingPrecompile.Coin memory bal) = STAKING.delegation(address(this), validator);
            uint256 actualWei = bal.amount * DECIMAL_BRIDGE;
            if (actualWei < recordedBonded) {
                uint256 loss = recordedBonded - actualWei;
                delegatedTo[validator] = actualWei;
                totalDelegated -= loss;
                lossWei += loss;
            }
        }

        // In-flight unbonding vs the chain's (unmatured) entries. Entries can
        // be slashed while unbonding. Compare AGGREGATES — the chain merges
        // same-height entries, so per-entry alignment is not guaranteed — and
        // apply any shortfall to the vault's recorded FIFO from the tail so
        // maturity accounting stays exact.
        uint256 recordedUnbonding = unbondingFrom[validator];
        // If the locally oldest entry has reached its completion time but is
        // still visible in consensus state, the chain has not settled it yet.
        // If more than MAX_SYNC_PER_CALL entries matured together, repeated
        // syncs drain them before aggregate reconciliation.  In both cases an
        // aggregate comparison here would misclassify a matured entry as a
        // slash, so fail closed until the local maturity backlog is clear.
        if (recordedUnbonding > 0 && !_hasLocallyMaturedUndelegation(validator)) {
            IStakingPrecompile.UnbondingDelegationOutput memory u =
                STAKING.unbondingDelegation(address(this), validator);
            uint256 actualWei;
            for (uint256 i = 0; i < u.entries.length; i++) {
                actualWei += u.entries[i].balance * DECIMAL_BRIDGE;
            }
            if (actualWei < recordedUnbonding) {
                uint256 loss = recordedUnbonding - actualWei;
                _applyUnbondingLoss(validator, loss);
                unbondingFrom[validator] = actualWei;
                totalUnbonding -= loss;
                lossWei += loss;
            }
        }

        if (lossWei > 0) _realizeSlashingLoss(validator, lossWei);
    }

    /// @notice Native AETHEL the withdrawal queue (and Merkle reserve) is owed
    ///         beyond what the balance plus in-flight undelegations cover.
    ///         A positive deficit opens the permissionless {undelegateForQueue}.
    function queueDeficit() public view returns (uint256) {
        uint256 promised = totalReserved + merkleReserve;
        uint256 covered = address(this).balance + totalUnbonding;
        return promised > covered ? promised - covered : 0;
    }

    /// @notice Total assets under management: native balance + bonded
    ///         delegations + in-flight undelegations. The Phase-2 solvency
    ///         invariant is totalManaged() >= totalPooledAethel +
    ///         totalReserved + merkleReserve (strictly greater once rewards
    ///         accrue between claims).
    function totalManaged() public view returns (uint256) {
        return address(this).balance + totalDelegated + totalUnbonding;
    }

    function _undelegate(string calldata validator, uint256 amountWei) internal returns (int64 completionTime) {
        totalDelegated -= amountWei;
        delegatedTo[validator] -= amountWei;
        totalUnbonding += amountWei;
        unbondingFrom[validator] += amountWei;

        completionTime = STAKING.undelegate(address(this), validator, amountWei / DECIMAL_BRIDGE);
        pendingUndelegations[validator].push(
            PendingUndelegation({amountWei: amountWei, completionTime: uint256(uint64(completionTime))})
        );
        emit Undelegated(validator, amountWei, completionTime);
    }

    function _syncUndelegations(string calldata validator) internal returns (uint256 maturedWei) {
        PendingUndelegation[] storage q = pendingUndelegations[validator];
        uint256 head = pendingHead[validator];
        uint256 len = q.length;
        // Bounded work per call: progress is monotonic and the function is
        // permissionless + repeatable, so no FIFO length can make it
        // permanently uncallable.
        uint256 limit = head + MAX_SYNC_PER_CALL;
        while (head < len && head < limit && q[head].completionTime <= block.timestamp) {
            maturedWei += q[head].amountWei;
            head++;
        }
        if (maturedWei > 0) {
            // completionTime is only a local hint.  Consensus removes an
            // entry and credits the vault atomically at settlement; do not
            // release in-flight coverage while the amount is still reported
            // by the staking precompile.  This closes the window where a
            // keeper could sync before EndBlock settlement.
            IStakingPrecompile.UnbondingDelegationOutput memory u =
                STAKING.unbondingDelegation(address(this), validator);
            uint256 actualUnbondingWei;
            for (uint256 i = 0; i < u.entries.length; i++) {
                actualUnbondingWei += u.entries[i].balance * DECIMAL_BRIDGE;
            }
            uint256 recordedAfterMaturity = unbondingFrom[validator] - maturedWei;
            if (actualUnbondingWei > recordedAfterMaturity) return 0;

            uint256 oldHead = pendingHead[validator];
            for (uint256 i = oldHead; i < head; i++) {
                delete q[i];
            }
            pendingHead[validator] = head;
            totalUnbonding -= maturedWei;
            unbondingFrom[validator] -= maturedWei;
            emit UndelegationsMatured(validator, maturedWei);

            // A matured entry may have been slashed immediately before the
            // chain removed it, at which point it is no longer queryable via
            // unbondingDelegation.  Use the native balance actually credited
            // by consensus as the final truth: after releasing the recorded
            // in-flight asset, any solvency deficit is realized immediately
            // instead of being permanently hidden from reconciliation.
            uint256 liabilities = totalPooledAethel + totalReserved + merkleReserve;
            uint256 managed = totalManaged();
            if (managed < liabilities) {
                uint256 deficit = liabilities - managed;
                // An already-recorded catastrophic deficit is part of this
                // same balance-sheet gap; only realize newly discovered loss.
                if (deficit > uncoveredDeficit) {
                    _realizeSlashingLoss(validator, deficit - uncoveredDeficit);
                }
            }
        }
    }

    function _hasLocallyMaturedUndelegation(string calldata validator) internal view returns (bool) {
        uint256 head = pendingHead[validator];
        PendingUndelegation[] storage q = pendingUndelegations[validator];
        return head < q.length && q[head].completionTime <= block.timestamp;
    }

    function _realizeSlashingLoss(string calldata validator, uint256 lossWei) internal {
        uint256 applied = lossWei > totalPooledAethel ? totalPooledAethel : lossWei;
        totalPooledAethel -= applied;
        uint256 catastrophic = lossWei - applied;
        if (catastrophic > 0) {
            uncoveredDeficit += catastrophic;
            depositsPaused = true;
            emit CatastrophicInsolvency(validator, uncoveredDeficit);
        }
        emit SlashingRealized(validator, lossWei, totalPooledAethel);
    }

    /// @notice Restore assets after a catastrophic slash. This deliberately
    ///         mints no shares and creates no new liability; overpayment is
    ///         rejected so recapitalization intent and accounting stay exact.
    ///         Deposits remain paused until governance completes its incident
    ///         checks and explicitly reopens them.
    function recapitalize() external payable nonReentrant {
        if (msg.value == 0 || msg.value > uncoveredDeficit) revert BadParam();
        uncoveredDeficit -= msg.value;
        emit Recapitalized(msg.sender, msg.value, uncoveredDeficit);
    }

    /// @dev Absorb an unbonding-slash into the recorded FIFO, newest entries
    ///      first, so a later {_syncUndelegations} releases exactly what the
    ///      chain will actually pay.
    function _applyUnbondingLoss(string calldata validator, uint256 loss) internal {
        PendingUndelegation[] storage q = pendingUndelegations[validator];
        uint256 head = pendingHead[validator];
        uint256 i = q.length;
        while (loss > 0 && i > head) {
            i--;
            uint256 cut = q[i].amountWei < loss ? q[i].amountWei : loss;
            q[i].amountWei -= cut;
            loss -= cut;
        }
    }

    /// @notice Withdraw the vault's EARNED x/staking rewards from a validator
    ///         and fold them into the pool: the exchange rate rises from real,
    ///         consensus-verified yield — not an operator's report. The
    ///         addRewards rate guard does not apply here; these amounts are
    ///         chain truth. PERMISSIONLESS: anyone may trigger a claim, since
    ///         it can only ever benefit every staker.
    function claimStakingRewards(string calldata validator) external nonReentrant returns (uint256 claimedWei) {
        uint256 before = address(this).balance;
        DISTRIBUTION.withdrawDelegatorRewards(address(this), validator);
        claimedWei = address(this).balance - before;
        if (claimedWei > 0) {
            uint256 healed = claimedWei > uncoveredDeficit ? uncoveredDeficit : claimedWei;
            uncoveredDeficit -= healed;
            totalPooledAethel += claimedWei - healed;
            if (healed > 0) emit Recapitalized(address(DISTRIBUTION), healed, uncoveredDeficit);
            emit RealYieldClaimed(validator, claimedWei, totalPooledAethel);
        }
    }

    /// @notice Claim a matured withdrawal: native AETHEL is paid out.
    function withdraw(uint256 withdrawalId) public nonReentrant {
        if (uncoveredDeficit != 0) revert ProtocolInsolvent(uncoveredDeficit);
        Withdrawal storage w = _ownedWithdrawal(withdrawalId);
        if (w.claimed) revert AlreadyClaimed();
        if (block.timestamp < w.completionTime) revert NotYetClaimable();

        w.claimed = true;
        totalReserved -= w.aethelAmount;
        emit Withdrawn(msg.sender, withdrawalId, w.aethelAmount);

        (bool sent,) = payable(msg.sender).call{value: w.aethelAmount}("");
        require(sent, "transfer failed");
    }

    /// @notice Claim several matured withdrawals in one transaction. Bounded
    ///         to MAX_BATCH_WITHDRAW entries per call so a caller cannot
    ///         construct an unbounded-gas loop; larger sets are claimed over
    ///         multiple calls.
    function batchWithdraw(uint256[] calldata withdrawalIds) external {
        if (withdrawalIds.length > MAX_BATCH_WITHDRAW) revert BatchTooLarge();
        for (uint256 i = 0; i < withdrawalIds.length; i++) {
            withdraw(withdrawalIds[i]);
        }
    }

    function _ownedWithdrawal(uint256 withdrawalId) internal view returns (Withdrawal storage) {
        address owner = withdrawalOwner[withdrawalId];
        if (owner == address(0)) revert UnknownWithdrawal();
        if (owner != msg.sender) revert NotWithdrawalOwner();
        return userWithdrawals[owner][withdrawalIndexPlus1[withdrawalId] - 1];
    }

    // ── rewards ──────────────────────────────────────────────────────────────

    /// @notice Route staking rewards into the pool: every stAETHEL balance
    ///         rebases upward. Callable by the rewarder (validator-commission
    ///         treasury routing).
    function addRewards() external payable onlyRewarder {
        if (msg.value == 0) revert ZeroAmount();
        // Rate guard: a single report may not rebase the pool by more than
        // maxRebaseBps, and reports may not arrive faster than
        // minRewardInterval. This bounds the rewarder key itself — a
        // compromised or fat-fingered key cannot swing the exchange rate in
        // one transaction (the incumbent-standard oracle sanity check).
        // No previous report → nothing to rate-limit against.
        if (lastRewardsAt != 0 && block.timestamp < lastRewardsAt + minRewardInterval) {
            revert RewardsTooFrequent();
        }
        if (totalPooledAethel > 0 && msg.value * 10_000 > totalPooledAethel * maxRebaseBps) {
            revert RebaseTooLarge();
        }
        lastRewardsAt = block.timestamp;
        totalPooledAethel += msg.value;
        emit RewardsAdded(msg.value, totalPooledAethel);
    }

    /// @notice Tune the reward-report guard, within hard bounds the guard
    ///         itself enforces: the cap can never exceed 20% per report and
    ///         the interval can never drop below 10 minutes — governance is
    ///         bounded too.
    function setRateGuard(uint256 maxRebaseBps_, uint256 minRewardInterval_) external onlyGovernance {
        if (maxRebaseBps_ == 0 || maxRebaseBps_ > 2000 || minRewardInterval_ < 10 minutes) revert BadParam();
        maxRebaseBps = maxRebaseBps_;
        minRewardInterval = minRewardInterval_;
        emit RateGuardSet(maxRebaseBps_, minRewardInterval_);
    }

    /// @notice Tune the instant-exit fee: hard-capped at 2%, and raises are
    ///         step-bounded to +50 bps per action so no single governance
    ///         action can jump the fee on users with transactions in flight.
    ///         Lowering is always unrestricted.
    function setInstantExitFee(uint256 feeBps) external onlyGovernance {
        if (feeBps > 200) revert BadParam();
        if (feeBps > instantExitFeeBps && feeBps - instantExitFeeBps > MAX_FEE_RAISE_STEP_BPS) {
            revert BadParam();
        }
        instantExitFeeBps = feeBps;
        emit InstantExitFeeSet(feeBps);
    }

    /// @notice Set the in-contract economic limits (0 disables a limit):
    ///         TVL cap and per-account cap bind on ENTRY only; the validator
    ///         concentration cap and minimum-buffer policy bind on DELEGATION.
    ///         Exits are never limited. For staged/canary rollouts.
    function setEconomicLimits(
        uint256 maxTotalPooled_,
        uint256 maxStakePerAccount_,
        uint256 maxValidatorBps_,
        uint256 minBufferBps_
    ) external onlyGovernance {
        if (maxValidatorBps_ > 10_000 || minBufferBps_ > 10_000) revert BadParam();
        maxTotalPooled = maxTotalPooled_;
        maxStakePerAccount = maxStakePerAccount_;
        maxValidatorBps = maxValidatorBps_;
        minBufferBps = minBufferBps_;
        emit EconomicLimitsSet(maxTotalPooled_, maxStakePerAccount_, maxValidatorBps_, minBufferBps_);
    }

    /// @notice Advance the epoch, checkpointing the exchange rate so APY is
    ///         computable from on-chain history.
    function advanceEpoch() external onlyRewarder {
        currentEpoch += 1;
        uint256 rate = _exchangeRate();
        epochRate[currentEpoch] = rate;
        epochTime[currentEpoch] = block.timestamp;
        emit EpochAdvanced(currentEpoch, rate);
    }

    /// @notice Post the Merkle root for an epoch's off-protocol reward program.
    function setRewardsRoot(uint256 epoch, bytes32 root) external onlyRewarder {
        rewardsRoot[epoch] = root;
        emit RewardsRootSet(epoch, root);
    }

    /// @notice Fund the Merkle reward reserve (segregated from the pool).
    function fundRewardsProgram() external payable onlyRewarder {
        if (msg.value == 0) revert ZeroAmount();
        merkleReserve += msg.value;
    }

    /// @notice Claim epoch rewards with a Merkle proof over (account, amount).
    ///         Pays exclusively from the segregated reserve.
    function claimRewards(uint256 epoch, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        bytes32 root = rewardsRoot[epoch];
        if (root == bytes32(0)) revert RootNotSet(epoch);
        if (rewardsClaimed[epoch][msg.sender]) revert AlreadyClaimed();
        if (amount > merkleReserve) revert InsufficientPool();

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        if (!_verifyProof(proof, root, leaf)) revert RewardsProofInvalid();

        rewardsClaimed[epoch][msg.sender] = true;
        merkleReserve -= amount;
        emit RewardsClaimed(msg.sender, epoch, amount);

        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "transfer failed");
    }

    function _verifyProof(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 node = proof[i];
            computed = computed <= node
                ? keccak256(abi.encodePacked(computed, node))
                : keccak256(abi.encodePacked(node, computed));
        }
        return computed == root;
    }

    // ── views the frontend consumes ──────────────────────────────────────────

    function totalShares() external view returns (uint256) {
        if (address(stAethel) == address(0)) return 0;
        return stAethel.getTotalShares();
    }

    function getExchangeRate() external view returns (uint256) {
        return _exchangeRate();
    }

    function _exchangeRate() internal view returns (uint256) {
        if (address(stAethel) == address(0)) return 1e18;
        uint256 shares_ = stAethel.getTotalShares();
        if (shares_ == 0) return 1e18;
        return (totalPooledAethel * 1e18) / shares_;
    }

    function getUserWithdrawals(address user) external view returns (Withdrawal[] memory) {
        return userWithdrawals[user];
    }

    function isWithdrawalClaimable(address user, uint256 withdrawalId) external view returns (bool) {
        address owner = withdrawalOwner[withdrawalId];
        if (owner != user) return false;
        Withdrawal storage w = userWithdrawals[owner][withdrawalIndexPlus1[withdrawalId] - 1];
        return !w.claimed && block.timestamp >= w.completionTime;
    }

    /// @notice APY in basis points, COMPUTED from the exchange-rate growth
    ///         between the two most recent epoch checkpoints and annualized —
    ///         never an operator-typed number. Returns 0 until two checkpoints
    ///         with elapsed time exist.
    function effectiveAPY() external view returns (uint256) {
        if (currentEpoch == 0) return 0;
        uint256 r1 = epochRate[currentEpoch];
        uint256 r0 = epochRate[currentEpoch - 1];
        uint256 t1 = epochTime[currentEpoch];
        uint256 t0 = epochTime[currentEpoch - 1];
        if (r0 == 0 || t1 <= t0 || r1 <= r0) return 0;
        // growth (1e18-scaled) over the interval, annualized linearly, in bps.
        uint256 growth = ((r1 - r0) * 1e18) / r0;
        return (growth * 365 days * 10_000) / ((t1 - t0) * 1e18);
    }

    // ── admin ────────────────────────────────────────────────────────────────

    function setDepositsPaused(bool paused) external {
        if (msg.sender != pauser && msg.sender != governance) revert NotPauser();
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    /// @notice Step 1 of a two-step governance handover: nominate the successor.
    ///         Governance is expected to be a timelock/multisig; two-step
    ///         transfer prevents an unrecoverable hand-off to a wrong address.
    function transferGovernance(address account) external onlyGovernance {
        if (account == address(0)) revert ZeroAddress();
        pendingGovernance = account;
        emit GovernanceTransferStarted(governance, account);
    }

    /// @notice Step 2: the nominee accepts, atomically becoming governance.
    function acceptGovernance() external {
        if (msg.sender != pendingGovernance) revert NotPendingGovernance();
        emit RoleSet("governance", pendingGovernance);
        governance = pendingGovernance;
        pendingGovernance = address(0);
    }

    function setRewarder(address account) external onlyGovernance {
        if (account == address(0)) revert ZeroAddress();
        rewarder = account;
        emit RoleSet("rewarder", account);
    }

    function setPauser(address account) external onlyGovernance {
        if (account == address(0)) revert ZeroAddress();
        pauser = account;
        emit RoleSet("pauser", account);
    }

    function setUnbondingPeriod(uint256 period) external onlyGovernance {
        unbondingPeriod = period;
    }

    // ── util ─────────────────────────────────────────────────────────────────

    /// @dev Lowercase 0x-prefixed hex of an address (EIP-55 not required: the
    ///      PoUW purpose binding is written lowercase by convention).
    function _toHexString(address account) internal pure returns (string memory) {
        bytes20 data = bytes20(account);
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
