/**
 * Governance Contract
 *
 * On-chain governance for the Aethelred network.
 * Supports proposal creation, voting, and execution.
 */
use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, CosmosMsg, Deps, DepsMut, Empty, Env, MessageInfo,
    Response, StdResult, Timestamp, Uint128,
};
use cw2::set_contract_version;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const CONTRACT_NAME: &str = "crates.io:aethelred-governance";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),
    #[error("Unauthorized")]
    Unauthorized {},
    #[error("Proposal not found")]
    ProposalNotFound {},
    #[error("Invalid proposal status")]
    InvalidStatus {},
    #[error("Voting period ended")]
    VotingEnded {},
    #[error("Voting period not started")]
    VotingNotStarted {},
    #[error("Already voted")]
    AlreadyVoted {},
    #[error("Insufficient deposit")]
    InsufficientDeposit {},
    #[error("Proposal not passed")]
    NotPassed {},
    #[error("Proposal already executed")]
    AlreadyExecuted {},
    #[error("Zero voting power: voter has no staked tokens")]
    ZeroVotingPower {},
    #[error("Quorum not met")]
    QuorumNotMet {},
    #[error("Stake not snapshotted: call SnapshotStake during the snapshot window before voting")]
    StakeNotSnapshotted {},
    #[error("Snapshot window ended")]
    SnapshotWindowEnded {},
    #[error("Voting has not started yet (snapshot window still open)")]
    VotingNotOpenYet {},
    #[error(
        "Total bonded value is stale: admin must call UpdateTotalBonded before proposal activation"
    )]
    StaleTotalBonded {},
    #[error("Total bonded inconsistency: participating voter weights exceed admin-reported total bonded")]
    TotalBondedInconsistency {},
    #[error("Total bonded delta exceeded: value deviates too far from last accepted anchor")]
    TotalBondedDeltaExceeded {},
    #[error("Anchor not seeded: admin must call SeedAnchor before any proposal can activate")]
    AnchorNotSeeded {},
    #[error("Activation cooldown: minimum time between proposal activations has not elapsed")]
    ActivationCooldownNotElapsed {},
    #[error("Anchor already seeded")]
    AnchorAlreadySeeded {},
    #[error("Not a registered oracle feeder")]
    NotAFeeder {},
    #[error("Feeder already registered")]
    FeederAlreadyRegistered {},
    #[error("Feeder not found")]
    FeederNotFound {},
    #[error(
        "Oracle consensus not reached: insufficient fresh submissions or values too divergent"
    )]
    ConsensusNotReached {},
    #[error("Cannot remove feeder: would reduce feeder count below min_feeder_quorum")]
    CannotRemoveBelowQuorum {},
    #[error("Feeder mutation cooldown not elapsed: minimum time between add/remove operations")]
    FeederMutationCooldownNotElapsed {},
    #[error("Timelock not elapsed: proposal must wait for execution_delay after voting ends")]
    TimelockNotElapsed {},
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    /// Voting period in seconds
    pub voting_period: u64,
    /// Minimum deposit to create proposal
    pub min_deposit: Uint128,
    /// Quorum requirement (basis points, 3340 = 33.4%)
    pub quorum: u64,
    /// Threshold to pass (basis points, 5000 = 50%)
    pub threshold: u64,
    /// Veto threshold (basis points, 3340 = 33.4%)
    pub veto_threshold: u64,
    /// MED-2: Timelock delay (seconds) between proposal passing and execution.
    /// Gives the community time to react to passed proposals before they execute.
    pub execution_delay: u64,
    /// Deposit denom
    pub deposit_denom: String,
    /// Snapshot window in seconds — period after activation during which voters
    /// must lock their stake via SnapshotStake. Voting begins only after the
    /// snapshot window closes, ensuring all weights are anchored to the same
    /// narrow time range rather than taken lazily at vote time.
    pub snapshot_period: u64,
    /// Maximum age (in seconds) of the TOTAL_BONDED value at proposal activation.
    /// If the admin's last UpdateTotalBonded call is older than this, the
    /// proposal cannot activate, constraining the window in which the admin
    /// could pre-position a favourable quorum denominator.
    pub max_staleness: u64,
    /// Maximum allowed deviation (basis points) of the current TOTAL_BONDED
    /// from the last accepted anchor value at proposal activation. Prevents the
    /// admin from making large jumps to overstate (censor) or understate (ease
    /// quorum) the denominator. E.g. 1000 = ±10% max drift per activation.
    /// The anchor moves only at activation, not at every UpdateTotalBonded call.
    pub max_delta_bps: u64,
    /// Minimum time (seconds) between successive proposal activations.
    /// Prevents the admin from "walking" the anchor in rapid bounded steps
    /// across multiple proposals. E.g. 86400 = 1 day minimum gap.
    pub min_activation_gap: u64,
    /// Minimum number of independent feeder submissions required for the
    /// total_bonded oracle to reach consensus. E.g. 2 = at least 2 feeders
    /// must agree. This distributes the trust assumption beyond a single admin.
    pub min_feeder_quorum: u32,
    /// Maximum deviation (basis points) allowed between individual feeder
    /// submissions for consensus to be reached. If any fresh submission
    /// deviates from the median by more than this, consensus fails.
    /// E.g. 500 = 5% tolerance between feeders.
    pub feeder_tolerance_bps: u64,
    /// Minimum time (seconds) between successive feeder add/remove operations.
    /// Prevents the admin from rapidly reshaping the oracle cohort. E.g. 86400 = 1 day.
    pub feeder_mutation_cooldown: u64,
    /// Quarantine period (seconds) for newly added feeders. During this time,
    /// the feeder's submissions are excluded from consensus. Prevents the admin
    /// from adding aligned feeders for immediate influence. E.g. 3600 = 1 hour.
    pub feeder_quarantine_period: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Proposal {
    pub id: u64,
    pub title: String,
    pub description: String,
    pub proposer: Addr,
    pub status: ProposalStatus,
    pub deposit: Uint128,

    // Vote counts
    pub votes_yes: Uint128,
    pub votes_no: Uint128,
    pub votes_abstain: Uint128,
    pub votes_no_with_veto: Uint128,

    // Timing
    pub submit_time: Timestamp,
    pub deposit_end_time: Timestamp,
    pub voting_start_time: Option<Timestamp>,
    pub voting_end_time: Option<Timestamp>,

    // Snapshots — captured at activation to anchor governance to stable state
    /// Total bonded tokens at the time the proposal entered voting.
    /// Used as the quorum denominator so admin cannot steer outcomes post-activation.
    pub snapshot_total_bonded: Uint128,
    /// Block height at activation — documents the intended stake snapshot point.
    pub snapshot_block: Option<u64>,
    /// End of the snapshot window. After activation, voters have until this
    /// time to call SnapshotStake. Voting only opens after this time.
    pub snapshot_end_time: Option<Timestamp>,

    // Execution
    pub executed: bool,
    pub execution_time: Option<Timestamp>,
    pub messages: Vec<CosmosMsg<Empty>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Pending,
    Active,
    Passed,
    Rejected,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Vote {
    pub voter: Addr,
    pub proposal_id: u64,
    pub option: VoteOption,
    pub weight: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum VoteOption {
    Yes,
    No,
    Abstain,
    NoWithVeto,
}

const CONFIG: Item<Config> = Item::new("config");
const PROPOSAL_COUNT: Item<u64> = Item::new("proposal_count");
const PROPOSALS: Map<u64, Proposal> = Map::new("proposals");
const VOTES: Map<(u64, &Addr), Vote> = Map::new("votes");
/// Total bonded tokens across the network, updated by admin.
/// Used as the denominator for quorum calculations.
const TOTAL_BONDED: Item<Uint128> = Item::new("total_bonded");
/// Timestamp of the last UpdateTotalBonded call.
/// Used to enforce a freshness constraint at proposal activation.
const TOTAL_BONDED_UPDATED_AT: Item<Timestamp> = Item::new("total_bonded_updated_at");
/// The last total_bonded value accepted at a proposal activation.
/// Used as the reference point for rate-limiting: each new activation can
/// only accept a value within ±max_delta_bps of this anchor. The anchor
/// moves only at activation — not at every UpdateTotalBonded call — so
/// rapid-fire admin updates cannot accumulate unbounded drift.
const TOTAL_BONDED_ANCHOR: Item<Uint128> = Item::new("total_bonded_anchor");
/// Timestamp of the last proposal activation.
/// Used to enforce `min_activation_gap` — the minimum time between successive
/// activations. This rate-limits how fast the admin can walk the anchor via
/// repeated bounded-step updates across multiple proposal activations.
const LAST_ACTIVATION_TIME: Item<Timestamp> = Item::new("last_activation_time");
/// Per-proposal stake snapshots: (proposal_id, voter) → delegated stake.
/// Voters must call SnapshotStake during the snapshot window (between
/// activation and snapshot_end_time). Voting requires an existing snapshot.
const STAKE_SNAPSHOTS: Map<(u64, &Addr), Uint128> = Map::new("stake_snapshots");

/// Authorized oracle feeders. Multiple independent feeders submit total_bonded
/// values; the canonical value updates only when `min_feeder_quorum` fresh
/// submissions agree within `feeder_tolerance_bps` of the median. This
/// distributes the trust assumption from a single admin to N independent parties.
const FEEDERS: Item<Vec<Addr>> = Item::new("feeders");

/// Per-feeder oracle submission: the latest value, timestamp, and epoch.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct FeederSubmission {
    pub value: Uint128,
    pub submitted_at: Timestamp,
    /// The oracle epoch at which this submission was made. Only submissions
    /// from the current epoch participate in consensus. Epoch increments on
    /// every feeder removal, forcing a full re-consensus from the new set.
    pub epoch: u64,
}
const FEEDER_SUBMISSIONS: Map<&Addr, FeederSubmission> = Map::new("feeder_submissions");

/// Timestamp of the last feeder add/remove operation.
/// Used to enforce `feeder_mutation_cooldown` — rate-limits how fast
/// the admin can reshape the oracle cohort.
const LAST_FEEDER_MUTATION_TIME: Item<Timestamp> = Item::new("last_feeder_mutation_time");

/// Per-feeder registration timestamp. Used to enforce a quarantine period:
/// newly added feeders' submissions are excluded from consensus until
/// `feeder_quarantine_period` has elapsed since registration.
const FEEDER_REGISTERED_AT: Map<&Addr, Timestamp> = Map::new("feeder_registered_at");

/// Oracle epoch counter. Incremented on every feeder removal. Submissions
/// carry the epoch at which they were made, and `check_oracle_consensus`
/// only considers submissions from the current epoch. This forces a full
/// re-consensus from the post-mutation feeder set whenever a feeder is
/// removed, preventing the admin from steering by pruning dissenters.
const ORACLE_EPOCH: Item<u64> = Item::new("oracle_epoch");

/// Response for the OracleStatus query.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct OracleStatusResponse {
    pub feeders: Vec<FeederInfo>,
    pub canonical_total_bonded: Uint128,
    pub canonical_updated_at: Timestamp,
    pub consensus_value: Option<Uint128>,
    pub min_feeder_quorum: u32,
    pub feeder_tolerance_bps: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct FeederInfo {
    pub address: Addr,
    pub latest_submission: Option<FeederSubmission>,
    pub is_fresh: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub voting_period: u64,
    pub min_deposit: Uint128,
    pub quorum: u64,
    pub threshold: u64,
    pub veto_threshold: u64,
    /// MED-2: Timelock delay (seconds) between passing and execution.
    pub execution_delay: u64,
    pub deposit_denom: String,
    /// Snapshot window in seconds after proposal activation.
    pub snapshot_period: u64,
    /// Maximum age in seconds for the total bonded oracle value.
    pub max_staleness: u64,
    /// Maximum allowed deviation (basis points) from the last accepted anchor.
    pub max_delta_bps: u64,
    /// Minimum seconds between successive proposal activations.
    pub min_activation_gap: u64,
    /// Minimum feeders required for oracle consensus (M in M-of-N).
    pub min_feeder_quorum: u32,
    /// Max deviation (bps) between feeder submissions for consensus.
    pub feeder_tolerance_bps: u64,
    /// Minimum seconds between successive feeder add/remove operations.
    pub feeder_mutation_cooldown: u64,
    /// Quarantine period (seconds) before a newly added feeder's submissions count.
    pub feeder_quarantine_period: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    SubmitProposal {
        title: String,
        description: String,
        messages: Vec<CosmosMsg<Empty>>,
    },
    Deposit {
        proposal_id: u64,
    },
    Vote {
        proposal_id: u64,
        option: VoteOption,
    },
    ExecuteProposal {
        proposal_id: u64,
    },
    /// Admin-only: update the total bonded tokens used for quorum calculation.
    /// Must be refreshed periodically from the staking module.
    UpdateTotalBonded {
        total_bonded: Uint128,
    },
    /// Lock the caller's current delegated stake for a proposal.
    /// **Mandatory** — must be called during the snapshot window (between
    /// proposal activation and `snapshot_end_time`). Voting requires a
    /// pre-existing snapshot; there is no lazy fallback at vote time.
    SnapshotStake {
        proposal_id: u64,
    },
    /// Admin-only: seed the initial anchor from the current TOTAL_BONDED.
    /// Must be called exactly once after contract instantiation and before
    /// any proposal can activate. This replaces the unconstrained bootstrap
    /// with an explicit, auditable admin action. Fails if the anchor has
    /// already been seeded (non-zero).
    SeedAnchor {},
    /// Admin-only: register a new oracle feeder. Multiple independent feeders
    /// distribute the trust assumption for the total_bonded oracle.
    AddFeeder {
        address: String,
    },
    /// Admin-only: remove an oracle feeder.
    RemoveFeeder {
        address: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},
    Proposal {
        proposal_id: u64,
    },
    Proposals {
        status: Option<String>,
        start_after: Option<u64>,
        limit: Option<u32>,
    },
    Vote {
        proposal_id: u64,
        voter: String,
    },
    Tally {
        proposal_id: u64,
    },
    /// Returns the oracle status: registered feeders, their latest
    /// submissions, current consensus value, and canonical total_bonded.
    OracleStatus {},
}

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let config = Config {
        admin: info.sender.clone(),
        voting_period: msg.voting_period,
        min_deposit: msg.min_deposit,
        quorum: msg.quorum,
        threshold: msg.threshold,
        veto_threshold: msg.veto_threshold,
        execution_delay: msg.execution_delay,
        deposit_denom: msg.deposit_denom,
        snapshot_period: msg.snapshot_period,
        max_staleness: msg.max_staleness,
        max_delta_bps: msg.max_delta_bps,
        min_activation_gap: msg.min_activation_gap,
        min_feeder_quorum: msg.min_feeder_quorum,
        feeder_tolerance_bps: msg.feeder_tolerance_bps,
        feeder_mutation_cooldown: msg.feeder_mutation_cooldown,
        feeder_quarantine_period: msg.feeder_quarantine_period,
    };

    CONFIG.save(deps.storage, &config)?;
    PROPOSAL_COUNT.save(deps.storage, &0)?;
    TOTAL_BONDED.save(deps.storage, &Uint128::zero())?;
    // Initialize to epoch zero so the first activation will always require
    // the admin to call UpdateTotalBonded at least once.
    TOTAL_BONDED_UPDATED_AT.save(deps.storage, &Timestamp::from_seconds(0))?;
    // Initialize anchor to zero. Admin must call SeedAnchor to set the
    // initial value before any proposal can activate. This ensures the
    // bootstrap is an explicit, auditable action rather than an
    // unconstrained first activation.
    TOTAL_BONDED_ANCHOR.save(deps.storage, &Uint128::zero())?;
    // Initialize to epoch zero so the first activation after seeding is
    // not blocked by the cooldown.
    LAST_ACTIVATION_TIME.save(deps.storage, &Timestamp::from_seconds(0))?;
    // Initialize to epoch zero so the first feeder mutation is not blocked.
    LAST_FEEDER_MUTATION_TIME.save(deps.storage, &Timestamp::from_seconds(0))?;
    // Register the admin as the first oracle feeder with epoch-zero
    // registration (no quarantine — admin is immediately active).
    FEEDERS.save(deps.storage, &vec![info.sender.clone()])?;
    FEEDER_REGISTERED_AT.save(deps.storage, &info.sender, &Timestamp::from_seconds(0))?;
    ORACLE_EPOCH.save(deps.storage, &0u64)?;

    Ok(Response::new().add_attribute("action", "instantiate"))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::SubmitProposal {
            title,
            description,
            messages,
        } => execute_submit_proposal(deps, env, info, title, description, messages),
        ExecuteMsg::Deposit { proposal_id } => execute_deposit(deps, env, info, proposal_id),
        ExecuteMsg::Vote {
            proposal_id,
            option,
        } => execute_vote(deps, env, info, proposal_id, option),
        ExecuteMsg::ExecuteProposal { proposal_id } => {
            execute_execute_proposal(deps, env, proposal_id)
        }
        ExecuteMsg::UpdateTotalBonded { total_bonded } => {
            execute_update_total_bonded(deps, env, info, total_bonded)
        }
        ExecuteMsg::SnapshotStake { proposal_id } => {
            execute_snapshot_stake(deps, env, info, proposal_id)
        }
        ExecuteMsg::SeedAnchor {} => execute_seed_anchor(deps, env, info),
        ExecuteMsg::AddFeeder { address } => execute_add_feeder(deps, env, info, address),
        ExecuteMsg::RemoveFeeder { address } => execute_remove_feeder(deps, env, info, address),
    }
}

fn execute_submit_proposal(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    title: String,
    description: String,
    messages: Vec<CosmosMsg<Empty>>,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // Check deposit
    let deposit = info
        .funds
        .iter()
        .find(|c| c.denom == config.deposit_denom)
        .map(|c| c.amount)
        .unwrap_or_default();

    let id = PROPOSAL_COUNT.load(deps.storage)? + 1;

    let proposal = Proposal {
        id,
        title: title.clone(),
        description,
        proposer: info.sender.clone(),
        status: ProposalStatus::Pending,
        deposit,
        votes_yes: Uint128::zero(),
        votes_no: Uint128::zero(),
        votes_abstain: Uint128::zero(),
        votes_no_with_veto: Uint128::zero(),
        submit_time: env.block.time,
        deposit_end_time: env.block.time.plus_seconds(86400), // 1 day deposit period
        voting_start_time: None,
        voting_end_time: None,
        snapshot_total_bonded: Uint128::zero(), // Set at activation
        snapshot_block: None,                   // Set at activation
        snapshot_end_time: None,                // Set at activation
        executed: false,
        execution_time: None,
        messages,
    };

    PROPOSALS.save(deps.storage, id, &proposal)?;
    PROPOSAL_COUNT.save(deps.storage, &id)?;

    Ok(Response::new()
        .add_attribute("action", "submit_proposal")
        .add_attribute("proposal_id", id.to_string())
        .add_attribute("proposer", info.sender))
}

fn execute_deposit(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    proposal_id: u64,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut proposal = PROPOSALS.load(deps.storage, proposal_id)?;

    if proposal.status != ProposalStatus::Pending {
        return Err(ContractError::InvalidStatus {});
    }

    if env.block.time > proposal.deposit_end_time {
        return Err(ContractError::VotingEnded {});
    }

    let deposit = info
        .funds
        .iter()
        .find(|c| c.denom == config.deposit_denom)
        .map(|c| c.amount)
        .unwrap_or_default();

    proposal.deposit += deposit;

    // Activate if min deposit reached
    if proposal.deposit >= config.min_deposit && proposal.status == ProposalStatus::Pending {
        // ── P2 fix: enforce freshness of the admin-supplied total_bonded ──
        // The admin can still pre-position the value, but it must have been
        // refreshed within `max_staleness` seconds of activation. This shrinks
        // the manipulation window from "any time before activation" to a narrow
        // band the community can audit.
        let updated_at = TOTAL_BONDED_UPDATED_AT.load(deps.storage)?;
        if env
            .block
            .time
            .seconds()
            .saturating_sub(updated_at.seconds())
            > config.max_staleness
        {
            return Err(ContractError::StaleTotalBonded {});
        }

        // ── Anchor seeding gate ──
        // The admin must have called SeedAnchor to explicitly set the initial
        // anchor. This eliminates the unconstrained bootstrap that previously
        // allowed the first activation to accept any total_bonded value.
        let current_bonded = TOTAL_BONDED.load(deps.storage)?;
        let anchor = TOTAL_BONDED_ANCHOR.load(deps.storage)?;
        if anchor.is_zero() {
            return Err(ContractError::AnchorNotSeeded {});
        }

        // ── Activation cooldown ──
        // Enforce a minimum time gap between successive proposal activations.
        // This prevents the admin from walking the anchor in rapid bounded
        // steps across back-to-back proposals — each step is bounded by
        // max_delta_bps, and each step requires min_activation_gap to elapse.
        let last_activation = LAST_ACTIVATION_TIME.load(deps.storage)?;
        if last_activation.seconds() > 0
            && env
                .block
                .time
                .seconds()
                .saturating_sub(last_activation.seconds())
                < config.min_activation_gap
        {
            return Err(ContractError::ActivationCooldownNotElapsed {});
        }

        // ── Anchor-relative rate limit ──
        // Prevent the admin from making a large jump (up or down) in the
        // quorum denominator between proposal activations. The anchor is the
        // value accepted at the *previous* activation; the current value must
        // be within ±max_delta_bps of that anchor.
        let delta = if current_bonded > anchor {
            current_bonded - anchor
        } else {
            anchor - current_bonded
        };
        let max_allowed = anchor * Uint128::from(config.max_delta_bps) / Uint128::from(10000u128);
        if delta > max_allowed {
            return Err(ContractError::TotalBondedDeltaExceeded {});
        }

        proposal.status = ProposalStatus::Active;
        // Snapshot window opens at activation and lasts for snapshot_period.
        // Voting only begins after the snapshot window closes.
        let snapshot_end = env.block.time.plus_seconds(config.snapshot_period);
        let voting_start = snapshot_end; // voting opens when snapshot window ends
        let voting_end = voting_start.plus_seconds(config.voting_period);

        proposal.voting_start_time = Some(voting_start);
        proposal.voting_end_time = Some(voting_end);
        proposal.snapshot_end_time = Some(snapshot_end);

        // Snapshot governance-critical state at activation so it cannot be
        // tampered with during the voting window.
        proposal.snapshot_total_bonded = current_bonded;
        proposal.snapshot_block = Some(env.block.height);

        // Move the anchor forward so the next activation is rate-limited
        // relative to this accepted value.
        TOTAL_BONDED_ANCHOR.save(deps.storage, &current_bonded)?;
        // Record activation time for cooldown enforcement.
        LAST_ACTIVATION_TIME.save(deps.storage, &env.block.time)?;
    }

    PROPOSALS.save(deps.storage, proposal_id, &proposal)?;

    Ok(Response::new()
        .add_attribute("action", "deposit")
        .add_attribute("proposal_id", proposal_id.to_string())
        .add_attribute("amount", deposit))
}

fn execute_update_total_bonded(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    total_bonded: Uint128,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // ── Multi-feeder authorization ──
    // Any registered feeder can submit — not just the admin. This distributes
    // the trust assumption from a single party to N independent oracle feeders.
    let feeders = FEEDERS.load(deps.storage)?;
    if !feeders.contains(&info.sender) {
        return Err(ContractError::NotAFeeder {});
    }

    // Record this feeder's submission with current epoch
    let epoch = ORACLE_EPOCH.load(deps.storage)?;
    FEEDER_SUBMISSIONS.save(
        deps.storage,
        &info.sender,
        &FeederSubmission {
            value: total_bonded,
            submitted_at: env.block.time,
            epoch,
        },
    )?;

    // ── Check oracle consensus ──
    // The canonical TOTAL_BONDED only updates when min_feeder_quorum fresh
    // submissions agree within feeder_tolerance_bps of the median.
    let consensus = check_oracle_consensus(deps.storage, &env, &config);

    let mut response = Response::new()
        .add_attribute("action", "update_total_bonded")
        .add_attribute("feeder", info.sender.to_string())
        .add_attribute("submitted_value", total_bonded);

    if let Some(median) = consensus {
        TOTAL_BONDED.save(deps.storage, &median)?;
        TOTAL_BONDED_UPDATED_AT.save(deps.storage, &env.block.time)?;
        response = response
            .add_attribute("consensus_reached", "true")
            .add_attribute("consensus_value", median);
    } else {
        response = response.add_attribute("consensus_reached", "false");
    }

    Ok(response)
}

/// Check if the oracle feeders have reached consensus on total_bonded.
/// Returns `Some(median)` if at least `min_feeder_quorum` fresh submissions
/// agree within `feeder_tolerance_bps`, or `None` otherwise.
///
/// Uses a **sliding window** over sorted values to find the largest agreeing
/// subset ≥ `min_feeder_quorum`. This means a single outlier feeder cannot
/// veto consensus when enough honest feeders agree — the outlier is simply
/// excluded from the agreeing subset.
///
/// **Ambiguity guard**: at each window size, if multiple qualifying windows
/// exist with *different* medians (split-brain), consensus is treated as
/// ambiguous and the function returns `None`. This prevents the sort-order
/// of submissions from deterministically picking one cluster over another.
///
/// **Quarantine**: feeders whose registration is more recent than
/// `feeder_quarantine_period` are excluded from consensus. This prevents
/// the admin from adding aligned feeders for immediate influence.
///
/// **Epoch filtering**: only submissions from the current `ORACLE_EPOCH`
/// participate in consensus. When a feeder is removed, the epoch increments,
/// invalidating ALL pre-removal submissions. The entire current feeder set
/// must re-submit, preventing the admin from steering by pruning a dissenter
/// and resubmitting an aligned value.
fn check_oracle_consensus(
    storage: &dyn cosmwasm_std::Storage,
    env: &Env,
    config: &Config,
) -> Option<Uint128> {
    let feeders = FEEDERS.load(storage).ok()?;
    let current_epoch = ORACLE_EPOCH.load(storage).unwrap_or(0);
    let mut fresh_values: Vec<Uint128> = Vec::new();

    for feeder in &feeders {
        // Skip quarantined feeders — recently added feeders cannot
        // participate in consensus until quarantine_period elapses.
        if config.feeder_quarantine_period > 0 {
            if let Ok(registered_at) = FEEDER_REGISTERED_AT.load(storage, feeder) {
                if env
                    .block
                    .time
                    .seconds()
                    .saturating_sub(registered_at.seconds())
                    < config.feeder_quarantine_period
                {
                    continue;
                }
            }
        }

        if let Ok(sub) = FEEDER_SUBMISSIONS.load(storage, feeder) {
            // Only consider submissions from the current epoch AND within staleness
            if sub.epoch == current_epoch
                && env
                    .block
                    .time
                    .seconds()
                    .saturating_sub(sub.submitted_at.seconds())
                    <= config.max_staleness
            {
                fresh_values.push(sub.value);
            }
        }
    }

    // Need at least min_feeder_quorum fresh submissions
    let min_q = config.min_feeder_quorum as usize;
    if fresh_values.len() < min_q {
        return None;
    }

    // Sort ascending so contiguous windows represent the tightest clusters
    fresh_values.sort();

    // Sliding window: try largest windows first (stronger consensus = more
    // feeders agreeing), then shrink down to min_feeder_quorum.
    //
    // At each window size, collect ALL qualifying medians. If there is
    // exactly one unique median, consensus is unambiguous → return it.
    // If there are multiple distinct medians at the same size (split-brain),
    // consensus is ambiguous → fall through to smaller windows. If no
    // window size yields an unambiguous consensus, return None.
    for window_size in (min_q..=fresh_values.len()).rev() {
        let mut qualifying_medians: Vec<Uint128> = Vec::new();

        for start in 0..=(fresh_values.len() - window_size) {
            let window = &fresh_values[start..start + window_size];
            // True median: for odd-length windows, the middle element;
            // for even-length windows, the arithmetic mean of the two
            // middle elements. This avoids systematic upward bias from
            // always picking the upper-middle value.
            let len = window.len();
            let median = if len % 2 == 1 {
                window[len / 2]
            } else {
                (window[len / 2 - 1] + window[len / 2]) / Uint128::from(2u128)
            };

            if median.is_zero() {
                continue;
            }

            // Check all values in this window are within tolerance of its median
            let mut all_within = true;
            for v in window {
                let delta = if *v > median {
                    *v - median
                } else {
                    median - *v
                };
                let max_allowed =
                    median * Uint128::from(config.feeder_tolerance_bps) / Uint128::from(10000u128);
                if delta > max_allowed {
                    all_within = false;
                    break;
                }
            }

            if all_within && !qualifying_medians.contains(&median) {
                qualifying_medians.push(median);
            }
        }

        // Exactly one unique median at this window size → unambiguous consensus
        if qualifying_medians.len() == 1 {
            return Some(qualifying_medians[0]);
        }
        // Multiple distinct medians → ambiguous split-brain, skip this size
        // (a larger overlap at a smaller window could still be unambiguous)
        // Zero qualifying → no cluster at this size, try smaller
    }

    None
}

/// Admin-only: seed the initial total_bonded anchor.
/// Must be called exactly once after instantiation (while anchor is zero)
/// and after at least one UpdateTotalBonded call. This replaces the
/// unconstrained bootstrap with an explicit, auditable admin action.
fn execute_seed_anchor(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    let anchor = TOTAL_BONDED_ANCHOR.load(deps.storage)?;
    if !anchor.is_zero() {
        return Err(ContractError::AnchorAlreadySeeded {});
    }

    let current_bonded = TOTAL_BONDED.load(deps.storage)?;
    if current_bonded.is_zero() {
        // Require at least one UpdateTotalBonded call first
        return Err(ContractError::StaleTotalBonded {});
    }

    TOTAL_BONDED_ANCHOR.save(deps.storage, &current_bonded)?;

    Ok(Response::new()
        .add_attribute("action", "seed_anchor")
        .add_attribute("anchor", current_bonded))
}

/// Admin-only: register a new oracle feeder.
/// Enforces mutation cooldown and records quarantine timestamp.
fn execute_add_feeder(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    address: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Enforce mutation cooldown — prevent rapid feeder set reshaping
    let last_mutation = LAST_FEEDER_MUTATION_TIME.load(deps.storage)?;
    if env
        .block
        .time
        .seconds()
        .saturating_sub(last_mutation.seconds())
        < config.feeder_mutation_cooldown
    {
        return Err(ContractError::FeederMutationCooldownNotElapsed {});
    }

    let feeder_addr = deps.api.addr_validate(&address)?;
    let mut feeders = FEEDERS.load(deps.storage)?;

    if feeders.contains(&feeder_addr) {
        return Err(ContractError::FeederAlreadyRegistered {});
    }

    feeders.push(feeder_addr.clone());
    FEEDERS.save(deps.storage, &feeders)?;
    // Record registration time — feeder is quarantined until this + quarantine_period
    FEEDER_REGISTERED_AT.save(deps.storage, &feeder_addr, &env.block.time)?;
    // Record mutation time for cooldown enforcement
    LAST_FEEDER_MUTATION_TIME.save(deps.storage, &env.block.time)?;

    Ok(Response::new()
        .add_attribute("action", "add_feeder")
        .add_attribute("feeder", feeder_addr)
        .add_attribute("total_feeders", feeders.len().to_string()))
}

/// Admin-only: remove an oracle feeder.
/// Enforces mutation cooldown and minimum feeder floor.
fn execute_remove_feeder(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    address: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Enforce mutation cooldown — prevent rapid feeder set reshaping
    let last_mutation = LAST_FEEDER_MUTATION_TIME.load(deps.storage)?;
    if env
        .block
        .time
        .seconds()
        .saturating_sub(last_mutation.seconds())
        < config.feeder_mutation_cooldown
    {
        return Err(ContractError::FeederMutationCooldownNotElapsed {});
    }

    let feeder_addr = deps.api.addr_validate(&address)?;
    let mut feeders = FEEDERS.load(deps.storage)?;

    // Check feeder exists before evaluating floor constraint
    let pos = feeders
        .iter()
        .position(|f| f == &feeder_addr)
        .ok_or(ContractError::FeederNotFound {})?;

    // Cannot remove below min_feeder_quorum — ensures the feeder set
    // always has enough members for consensus to be possible.
    if feeders.len() <= config.min_feeder_quorum as usize {
        return Err(ContractError::CannotRemoveBelowQuorum {});
    }

    feeders.swap_remove(pos);
    FEEDERS.save(deps.storage, &feeders)?;

    // Clean up removed feeder's submission and registration
    FEEDER_SUBMISSIONS.remove(deps.storage, &feeder_addr);
    FEEDER_REGISTERED_AT.remove(deps.storage, &feeder_addr);

    // Increment oracle epoch — invalidates ALL pre-removal submissions.
    // The entire remaining feeder set must re-submit at the new epoch
    // for consensus to be reached. This prevents the admin from steering
    // by removing a dissenter and resubmitting an aligned value, because
    // the admin alone cannot reach min_feeder_quorum.
    let epoch = ORACLE_EPOCH.load(deps.storage)?;
    ORACLE_EPOCH.save(deps.storage, &(epoch + 1))?;
    // Record mutation time for cooldown enforcement
    LAST_FEEDER_MUTATION_TIME.save(deps.storage, &env.block.time)?;

    Ok(Response::new()
        .add_attribute("action", "remove_feeder")
        .add_attribute("feeder", feeder_addr)
        .add_attribute("total_feeders", feeders.len().to_string()))
}

fn execute_snapshot_stake(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    proposal_id: u64,
) -> Result<Response, ContractError> {
    let proposal = PROPOSALS.load(deps.storage, proposal_id)?;

    if proposal.status != ProposalStatus::Active {
        return Err(ContractError::InvalidStatus {});
    }

    // Snapshots are only allowed during the dedicated snapshot window
    // (activation → snapshot_end_time). This ensures all voter weights are
    // anchored to a narrow, pre-determined time range — not lazily taken
    // whenever a voter happens to cast.
    let snapshot_end = proposal.snapshot_end_time.unwrap();
    if env.block.time > snapshot_end {
        return Err(ContractError::SnapshotWindowEnded {});
    }

    // Only allow one snapshot per (proposal, voter). Once locked, immutable.
    if STAKE_SNAPSHOTS.has(deps.storage, (proposal_id, &info.sender)) {
        return Ok(Response::new()
            .add_attribute("action", "snapshot_stake")
            .add_attribute("status", "already_snapshotted"));
    }

    let delegations = deps.querier.query_all_delegations(&info.sender)?;
    let total: Uint128 = delegations
        .iter()
        .map(|d| d.amount.amount)
        .fold(Uint128::zero(), |acc, a| acc + a);

    STAKE_SNAPSHOTS.save(deps.storage, (proposal_id, &info.sender), &total)?;

    Ok(Response::new()
        .add_attribute("action", "snapshot_stake")
        .add_attribute("proposal_id", proposal_id.to_string())
        .add_attribute("voter", info.sender)
        .add_attribute("weight", total))
}

fn execute_vote(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    proposal_id: u64,
    option: VoteOption,
) -> Result<Response, ContractError> {
    let mut proposal = PROPOSALS.load(deps.storage, proposal_id)?;

    if proposal.status != ProposalStatus::Active {
        return Err(ContractError::InvalidStatus {});
    }

    // ── P1 fix: voting only opens after the snapshot window closes ──
    // This guarantees that all voter weights were locked during a narrow,
    // predetermined window — not lazily taken at an attacker-chosen time.
    let snapshot_end = proposal.snapshot_end_time.unwrap();
    if env.block.time <= snapshot_end {
        return Err(ContractError::VotingNotOpenYet {});
    }

    let voting_end = proposal.voting_end_time.unwrap();
    if env.block.time > voting_end {
        return Err(ContractError::VotingEnded {});
    }

    // Check if already voted
    if VOTES.has(deps.storage, (proposal_id, &info.sender)) {
        return Err(ContractError::AlreadyVoted {});
    }

    // ── P1 fix: require an existing stake snapshot — no lazy fallback ──
    // Voters MUST have called SnapshotStake during the snapshot window.
    // This removes the old lazy branch that queried live delegations at
    // vote time, which allowed voters to choose a favorable moment to cast.
    let weight = STAKE_SNAPSHOTS
        .may_load(deps.storage, (proposal_id, &info.sender))?
        .ok_or(ContractError::StakeNotSnapshotted {})?;

    if weight.is_zero() {
        return Err(ContractError::ZeroVotingPower {});
    }

    // Record vote
    let vote = Vote {
        voter: info.sender.clone(),
        proposal_id,
        option: option.clone(),
        weight,
    };
    VOTES.save(deps.storage, (proposal_id, &info.sender), &vote)?;

    // Update tallies
    match option {
        VoteOption::Yes => proposal.votes_yes += weight,
        VoteOption::No => proposal.votes_no += weight,
        VoteOption::Abstain => proposal.votes_abstain += weight,
        VoteOption::NoWithVeto => proposal.votes_no_with_veto += weight,
    }

    PROPOSALS.save(deps.storage, proposal_id, &proposal)?;

    Ok(Response::new()
        .add_attribute("action", "vote")
        .add_attribute("proposal_id", proposal_id.to_string())
        .add_attribute("voter", info.sender)
        .add_attribute("option", format!("{:?}", option)))
}

fn execute_execute_proposal(
    deps: DepsMut,
    env: Env,
    proposal_id: u64,
) -> Result<Response, ContractError> {
    let mut proposal = PROPOSALS.load(deps.storage, proposal_id)?;

    if proposal.executed {
        return Err(ContractError::AlreadyExecuted {});
    }

    // P2 fix: only Active proposals have voting_end_time; reject others
    // before unwrapping to avoid a panic on Pending/Rejected/Failed proposals.
    if proposal.status != ProposalStatus::Active {
        return Err(ContractError::InvalidStatus {});
    }

    // Safe to unwrap: Active proposals always have voting_end_time set.
    let voting_end = proposal.voting_end_time.unwrap();
    if env.block.time <= voting_end {
        return Err(ContractError::VotingNotStarted {});
    }

    // MED-2 FIX: Enforce timelock — proposal cannot execute until execution_delay
    // seconds after voting ends. This gives the community time to react.
    let config = CONFIG.load(deps.storage)?;
    let earliest_execution = voting_end.plus_seconds(config.execution_delay);
    if env.block.time < earliest_execution {
        return Err(ContractError::TimelockNotElapsed {});
    }

    // Calculate results
    let total_votes = proposal.votes_yes
        + proposal.votes_no
        + proposal.votes_abstain
        + proposal.votes_no_with_veto;

    // Enforce quorum against the total_bonded snapshot taken at proposal activation,
    // NOT the live TOTAL_BONDED value. This prevents the admin from steering quorum
    // by rewriting total_bonded after voting has already begun.
    let snapshot_bonded = proposal.snapshot_total_bonded;
    if snapshot_bonded.is_zero() {
        // Snapshot was zero at activation — cannot verify quorum.
        return Err(ContractError::QuorumNotMet {});
    }

    // ── On-chain consistency bound ──
    // The sum of all voter-snapshotted weights can never legitimately exceed
    // the total bonded tokens on the network. If it does, the admin understated
    // the denominator — making quorum artificially easy to reach. This check
    // catches the *dangerous* direction of manipulation (lowering the bar).
    //
    // The admin can still *overstate* total_bonded, which makes quorum harder
    // to reach and could block proposals — but that is a liveness issue, not a
    // safety issue, and is detectable off-chain via standard staking queries.
    if total_votes > snapshot_bonded {
        proposal.status = ProposalStatus::Rejected;
        PROPOSALS.save(deps.storage, proposal_id, &proposal)?;
        return Err(ContractError::TotalBondedInconsistency {});
    }

    let quorum_threshold =
        snapshot_bonded * Uint128::from(config.quorum) / Uint128::from(10000u128);
    if total_votes < quorum_threshold {
        proposal.status = ProposalStatus::Rejected;
        PROPOSALS.save(deps.storage, proposal_id, &proposal)?;
        return Err(ContractError::QuorumNotMet {});
    }

    // Check veto
    let veto_threshold =
        total_votes * Uint128::from(config.veto_threshold) / Uint128::from(10000u128);
    if proposal.votes_no_with_veto > veto_threshold {
        proposal.status = ProposalStatus::Rejected;
        PROPOSALS.save(deps.storage, proposal_id, &proposal)?;
        return Err(ContractError::NotPassed {});
    }

    // Check pass threshold
    let pass_threshold = (proposal.votes_yes + proposal.votes_no) * Uint128::from(config.threshold)
        / Uint128::from(10000u128);
    if proposal.votes_yes < pass_threshold {
        proposal.status = ProposalStatus::Rejected;
        PROPOSALS.save(deps.storage, proposal_id, &proposal)?;
        return Err(ContractError::NotPassed {});
    }

    proposal.status = ProposalStatus::Passed;
    proposal.executed = true;
    proposal.execution_time = Some(env.block.time);
    PROPOSALS.save(deps.storage, proposal_id, &proposal)?;

    // Execute messages
    let mut response = Response::new()
        .add_attribute("action", "execute_proposal")
        .add_attribute("proposal_id", proposal_id.to_string());

    for msg in &proposal.messages {
        response = response.add_message(msg.clone());
    }

    Ok(response)
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&CONFIG.load(deps.storage)?),
        QueryMsg::Proposal { proposal_id } => {
            let proposal = PROPOSALS.load(deps.storage, proposal_id)?;
            to_json_binary(&proposal)
        }
        QueryMsg::Proposals {
            status,
            start_after,
            limit,
        } => to_json_binary(&query_proposals(deps, status, start_after, limit)?),
        QueryMsg::Vote { proposal_id, voter } => {
            let addr = deps.api.addr_validate(&voter)?;
            let vote = VOTES.load(deps.storage, (proposal_id, &addr))?;
            to_json_binary(&vote)
        }
        QueryMsg::Tally { proposal_id } => {
            let proposal = PROPOSALS.load(deps.storage, proposal_id)?;
            to_json_binary(&serde_json::json!({
                "yes": proposal.votes_yes,
                "no": proposal.votes_no,
                "abstain": proposal.votes_abstain,
                "no_with_veto": proposal.votes_no_with_veto,
            }))
        }
        QueryMsg::OracleStatus {} => to_json_binary(&query_oracle_status(deps, _env)?),
    }
}

fn query_proposals(
    deps: Deps,
    status: Option<String>,
    start_after: Option<u64>,
    limit: Option<u32>,
) -> StdResult<Vec<Proposal>> {
    let limit = limit.unwrap_or(50).min(100) as usize;

    // Parse the optional status filter once.
    let status_filter: Option<ProposalStatus> = status.as_deref().and_then(|s| match s {
        "pending" => Some(ProposalStatus::Pending),
        "active" => Some(ProposalStatus::Active),
        "passed" => Some(ProposalStatus::Passed),
        "rejected" => Some(ProposalStatus::Rejected),
        "failed" => Some(ProposalStatus::Failed),
        _ => None,
    });

    // Use start_after for cursor-based pagination (ascending order).
    let min = start_after.map(cw_storage_plus::Bound::exclusive);

    let proposals: Vec<Proposal> = PROPOSALS
        .range(deps.storage, min, None, cosmwasm_std::Order::Ascending)
        .filter_map(|r| r.ok().map(|(_, p)| p))
        .filter(|p| match &status_filter {
            Some(target) => p.status == *target,
            None => true,
        })
        .take(limit)
        .collect();
    Ok(proposals)
}

fn query_oracle_status(deps: Deps, env: Env) -> StdResult<OracleStatusResponse> {
    let config = CONFIG.load(deps.storage)?;
    let feeders = FEEDERS.load(deps.storage)?;
    let canonical_total_bonded = TOTAL_BONDED.load(deps.storage)?;
    let canonical_updated_at = TOTAL_BONDED_UPDATED_AT.load(deps.storage)?;

    let mut feeder_infos: Vec<FeederInfo> = Vec::new();
    for feeder in &feeders {
        let submission = FEEDER_SUBMISSIONS.may_load(deps.storage, feeder)?;
        let is_fresh = submission.as_ref().map_or(false, |s| {
            env.block
                .time
                .seconds()
                .saturating_sub(s.submitted_at.seconds())
                <= config.max_staleness
        });
        feeder_infos.push(FeederInfo {
            address: feeder.clone(),
            latest_submission: submission,
            is_fresh,
        });
    }

    let consensus_value = check_oracle_consensus(deps.storage, &env, &config);

    Ok(OracleStatusResponse {
        feeders: feeder_infos,
        canonical_total_bonded,
        canonical_updated_at,
        consensus_value,
        min_feeder_quorum: config.min_feeder_quorum,
        feeder_tolerance_bps: config.feeder_tolerance_bps,
    })
}

// L-04 FIX: Migration entry point for on-chain contract upgrades.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> StdResult<Response> {
    let version = cw2::get_contract_version(deps.storage)?;
    if version.contract != CONTRACT_NAME {
        return Err(cosmwasm_std::StdError::generic_err(
            "Cannot migrate from a different contract",
        ));
    }
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new()
        .add_attribute("action", "migrate")
        .add_attribute("from_version", version.version)
        .add_attribute("to_version", CONTRACT_VERSION))
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::{coins, from_json, Coin, Decimal, FullDelegation, Validator};

    // ── Helpers ──────────────────────────────────────────────────────────

    const ADMIN: &str = "admin";
    const VOTER_A: &str = "voter_a";
    const VOTER_B: &str = "voter_b";
    const DENOM: &str = "uaeth";
    const VALIDATOR: &str = "validator1";

    /// Standard InstantiateMsg with sensible defaults.
    /// voting_period = 600s, snapshot_period = 120s, max_staleness = 300s,
    /// max_delta_bps = 1000 (±10%), min_activation_gap = 3600 (1 hour),
    /// quorum = 3340 bps (33.4%), threshold = 5000 bps, veto = 3340 bps.
    fn default_init_msg() -> InstantiateMsg {
        InstantiateMsg {
            voting_period: 600,
            min_deposit: Uint128::from(1_000_000u128),
            quorum: 3340,
            threshold: 5000,
            veto_threshold: 3340,
            execution_delay: 60, // 60s timelock for tests
            deposit_denom: DENOM.to_string(),
            snapshot_period: 120,
            max_staleness: 300,
            max_delta_bps: 1000,         // ±10%
            min_activation_gap: 60,      // 60s for tests (production should be higher)
            min_feeder_quorum: 1,        // single-feeder default for backward compat
            feeder_tolerance_bps: 500,   // 5% tolerance between feeders
            feeder_mutation_cooldown: 0, // no cooldown for single-feeder tests
            feeder_quarantine_period: 0, // no quarantine for single-feeder tests
        }
    }

    fn setup_contract(
        deps: &mut cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
    ) {
        let msg = default_init_msg();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();
    }

    /// Configure mock staking state: one validator with delegations.
    fn set_delegations(
        deps: &mut cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
        delegations: &[(&str, u128)],
    ) {
        let validator = Validator {
            address: VALIDATOR.to_string(),
            commission: Decimal::percent(10),
            max_commission: Decimal::percent(20),
            max_change_rate: Decimal::percent(1),
        };

        let full_delegations: Vec<FullDelegation> = delegations
            .iter()
            .map(|(delegator, amount)| FullDelegation {
                delegator: cosmwasm_std::Addr::unchecked(*delegator),
                validator: VALIDATOR.to_string(),
                amount: Coin {
                    denom: DENOM.to_string(),
                    amount: Uint128::from(*amount),
                },
                can_redelegate: Coin {
                    denom: DENOM.to_string(),
                    amount: Uint128::from(*amount),
                },
                accumulated_rewards: vec![],
            })
            .collect();

        deps.querier
            .update_staking(DENOM, &[validator], &full_delegations);
    }

    fn env_at(seconds: u64) -> Env {
        let mut env = mock_env();
        env.block.time = Timestamp::from_seconds(seconds);
        env.block.height = seconds / 5; // ~5s blocks
        env
    }

    /// Submit a proposal and return its ID.
    fn submit_proposal(
        deps: &mut cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
        env: Env,
    ) -> u64 {
        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        execute(
            deps.as_mut(),
            env,
            info,
            ExecuteMsg::SubmitProposal {
                title: "Test Proposal".to_string(),
                description: "A test proposal".to_string(),
                messages: vec![],
            },
        )
        .unwrap();
        1 // first proposal
    }

    /// Admin refreshes total_bonded.
    fn refresh_total_bonded(
        deps: &mut cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
        env: Env,
        amount: u128,
    ) {
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env,
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(amount),
            },
        )
        .unwrap();
    }

    /// Admin seeds the initial anchor (required before any activation).
    fn seed_anchor(
        deps: &mut cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
        env: Env,
    ) {
        let info = mock_info(ADMIN, &[]);
        execute(deps.as_mut(), env, info, ExecuteMsg::SeedAnchor {}).unwrap();
    }

    /// Deposit enough to activate.
    fn activate_proposal(
        deps: &mut cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
        env: Env,
        proposal_id: u64,
    ) {
        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        execute(
            deps.as_mut(),
            env,
            info,
            ExecuteMsg::Deposit { proposal_id },
        )
        .unwrap();
    }

    // ── Test: full lifecycle ─────────────────────────────────────────────

    #[test]
    fn test_full_lifecycle() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000), (VOTER_B, 3_000_000)]);

        let t0 = 1_000_000u64;

        // Admin refreshes total_bonded and seeds anchor
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));

        // Submit proposal (partial deposit)
        submit_proposal(&mut deps, env_at(t0 + 10));

        // Deposit remaining to activate
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Verify proposal is Active
        let prop: Proposal = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 20),
                QueryMsg::Proposal { proposal_id: 1 },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(prop.status, ProposalStatus::Active);
        assert!(prop.snapshot_end_time.is_some());
        assert_eq!(prop.snapshot_total_bonded, Uint128::from(10_000_000u128));

        // Snapshot window: t0+20 → t0+140 (120s snapshot_period)
        // Snapshot voter A during the window
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 50),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        // Snapshot voter B
        let info = mock_info(VOTER_B, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 60),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        // Voting window: t0+140 → t0+740 (600s voting_period)
        // Vote Yes from both
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();

        let info = mock_info(VOTER_B, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 210),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();

        // Execute after voting ends
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 800),
            mock_info(VOTER_A, &[]),
            ExecuteMsg::ExecuteProposal { proposal_id: 1 },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "execute_proposal");

        // Verify passed
        let prop: Proposal = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 800),
                QueryMsg::Proposal { proposal_id: 1 },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(prop.status, ProposalStatus::Passed);
        assert!(prop.executed);
    }

    // ── Test: snapshot window enforcement ─────────────────────────────────

    #[test]
    fn test_snapshot_after_window_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000)]);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Try to snapshot after the window closes (t0 + 20 + 120 = t0 + 140)
        let info = mock_info(VOTER_A, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 150),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::SnapshotWindowEnded {});
    }

    // ── Test: voting rejected during snapshot window ─────────────────────

    #[test]
    fn test_vote_during_snapshot_window_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000)]);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Snapshot during window
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 50),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        // Try to vote while still in snapshot window
        let info = mock_info(VOTER_A, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 100), // still within t0+140 snapshot_end
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::VotingNotOpenYet {});
    }

    // ── Test: vote without snapshot rejected ──────────────────────────────

    #[test]
    fn test_vote_without_snapshot_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000)]);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Skip snapshot entirely, try to vote after window
        let info = mock_info(VOTER_A, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::StakeNotSnapshotted {});
    }

    // ── Test: stale total_bonded blocks activation ───────────────────────

    #[test]
    fn test_stale_total_bonded_blocks_activation() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;
        // Refresh at t0, seed anchor, then try to activate at t0 + 400 (>300s max_staleness)
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));

        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 400),
            info,
            ExecuteMsg::Deposit { proposal_id: 1 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::StaleTotalBonded {});
    }

    // ── Test: fresh total_bonded allows activation ───────────────────────

    #[test]
    fn test_fresh_total_bonded_allows_activation() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));

        // Activate within freshness window (200s < 300s max_staleness)
        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Deposit { proposal_id: 1 },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "deposit");
    }

    // ── Test: consistency bound catches understated total_bonded ──────────

    #[test]
    fn test_consistency_bound_catches_understated_total_bonded() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        // Voter A has 5M staked, voter B has 3M = 8M total
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000), (VOTER_B, 3_000_000)]);

        let t0 = 1_000_000u64;
        // Admin lies: reports only 6M total bonded (actual participating = 8M)
        refresh_total_bonded(&mut deps, env_at(t0), 6_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Snapshot both voters
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 50),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();
        let info = mock_info(VOTER_B, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 60),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        // Both vote Yes → total_votes = 8M > snapshot_bonded = 6M
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();
        let info = mock_info(VOTER_B, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 210),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();

        // Execute — should fail with TotalBondedInconsistency
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 800),
            mock_info(VOTER_A, &[]),
            ExecuteMsg::ExecuteProposal { proposal_id: 1 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::TotalBondedInconsistency {});

        // Verify proposal was rejected
        let prop: Proposal = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 800),
                QueryMsg::Proposal { proposal_id: 1 },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(prop.status, ProposalStatus::Rejected);
    }

    // ── Test: zero voting power rejected ─────────────────────────────────

    #[test]
    fn test_zero_voting_power_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        // Voter A has zero delegation
        set_delegations(&mut deps, &[(VOTER_A, 0)]);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Snapshot (will record 0)
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 50),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        // Vote — rejected for zero power
        let info = mock_info(VOTER_A, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::ZeroVotingPower {});
    }

    // ── Test: quorum not met ─────────────────────────────────────────────

    #[test]
    fn test_quorum_not_met() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        // Only 1M out of 10M total — quorum needs 33.4% = 3.34M
        set_delegations(&mut deps, &[(VOTER_A, 1_000_000)]);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 50),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();

        let err = execute(
            deps.as_mut(),
            env_at(t0 + 800),
            mock_info(VOTER_A, &[]),
            ExecuteMsg::ExecuteProposal { proposal_id: 1 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::QuorumNotMet {});
    }

    // ── Test: double vote rejected ───────────────────────────────────────

    #[test]
    fn test_double_vote_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000)]);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 50),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();

        // Second vote
        let info = mock_info(VOTER_A, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 210),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::No,
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::AlreadyVoted {});
    }

    // ── Test: only registered feeders can update total_bonded ─────────────

    #[test]
    fn test_non_feeder_cannot_update_total_bonded() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        // VOTER_A is not a registered feeder — should be rejected
        let info = mock_info(VOTER_A, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(1_000_000),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(999u128),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::NotAFeeder {});
    }

    // ── Test: duplicate snapshot is idempotent ────────────────────────────

    #[test]
    fn test_duplicate_snapshot_idempotent() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000)]);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // First snapshot
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 50),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        // Second snapshot — should succeed but return "already_snapshotted"
        let info = mock_info(VOTER_A, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 60),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.value == "already_snapshotted"));
    }

    // ── Test: execute on non-Active proposal rejected ────────────────────

    #[test]
    fn test_execute_pending_proposal_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;
        submit_proposal(&mut deps, env_at(t0 + 10));

        // Try to execute a Pending proposal
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 100),
            mock_info(VOTER_A, &[]),
            ExecuteMsg::ExecuteProposal { proposal_id: 1 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::InvalidStatus {});
    }

    // ── Test: query_proposals status filter and pagination ────────────────

    #[test]
    fn test_query_proposals_filter_and_pagination() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;
        // Create 3 proposals (all Pending)
        for i in 0..3 {
            let info = mock_info(VOTER_A, &coins(500_000, DENOM));
            execute(
                deps.as_mut(),
                env_at(t0 + i * 10),
                info,
                ExecuteMsg::SubmitProposal {
                    title: format!("Proposal {}", i + 1),
                    description: "test".to_string(),
                    messages: vec![],
                },
            )
            .unwrap();
        }

        // Query all
        let res: Vec<Proposal> = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 100),
                QueryMsg::Proposals {
                    status: None,
                    start_after: None,
                    limit: None,
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(res.len(), 3);

        // Query with pagination: start_after=1, limit=1
        let res: Vec<Proposal> = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 100),
                QueryMsg::Proposals {
                    status: None,
                    start_after: Some(1),
                    limit: Some(1),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].id, 2);

        // Query by status — none are Active
        let res: Vec<Proposal> = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 100),
                QueryMsg::Proposals {
                    status: Some("active".to_string()),
                    start_after: None,
                    limit: None,
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(res.len(), 0);
    }

    // ── Test: veto threshold rejects proposal ────────────────────────────

    #[test]
    fn test_veto_rejects_proposal() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        // A votes yes (5M), B votes no_with_veto (5M) — veto > 33.4% of total
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000), (VOTER_B, 5_000_000)]);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Snapshot both
        for voter in [VOTER_A, VOTER_B] {
            let info = mock_info(voter, &[]);
            execute(
                deps.as_mut(),
                env_at(t0 + 50),
                info,
                ExecuteMsg::SnapshotStake { proposal_id: 1 },
            )
            .unwrap();
        }

        // A votes Yes, B votes NoWithVeto
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();

        let info = mock_info(VOTER_B, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 210),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::NoWithVeto,
            },
        )
        .unwrap();

        let err = execute(
            deps.as_mut(),
            env_at(t0 + 800),
            mock_info(VOTER_A, &[]),
            ExecuteMsg::ExecuteProposal { proposal_id: 1 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::NotPassed {});
    }

    // ── Test: seed anchor enables first activation ──────────────────────

    #[test]
    fn test_seed_anchor_enables_activation() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 50_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));

        // Should succeed — anchor seeded, activation allowed
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        let prop: Proposal = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 20),
                QueryMsg::Proposal { proposal_id: 1 },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(prop.status, ProposalStatus::Active);
        assert_eq!(prop.snapshot_total_bonded, Uint128::from(50_000_000u128));
    }

    // ── Test: unseeded anchor blocks activation ───────────────────────

    #[test]
    fn test_unseeded_anchor_blocks_activation() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        // Do NOT seed anchor
        submit_proposal(&mut deps, env_at(t0 + 10));

        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 20),
            info,
            ExecuteMsg::Deposit { proposal_id: 1 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::AnchorNotSeeded {});
    }

    // ── Test: double seed rejected ────────────────────────────────────

    #[test]
    fn test_double_seed_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));

        // Second seed should fail
        let info = mock_info(ADMIN, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 10),
            info,
            ExecuteMsg::SeedAnchor {},
        )
        .unwrap_err();
        assert_eq!(err, ContractError::AnchorAlreadySeeded {});
    }

    // ── Test: anchor rate limit — overstated total_bonded rejected ────────

    #[test]
    fn test_overstated_total_bonded_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;

        // First activation: establish anchor at 10M
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);
        // anchor is now 10M

        // Admin overstates to 15M (+50%, exceeds ±10% max_delta_bps=1000)
        refresh_total_bonded(&mut deps, env_at(t0 + 100), 15_000_000);

        // Submit and try to activate second proposal (after 60s cooldown)
        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        execute(
            deps.as_mut(),
            env_at(t0 + 100),
            info,
            ExecuteMsg::SubmitProposal {
                title: "Proposal 2".to_string(),
                description: "test".to_string(),
                messages: vec![],
            },
        )
        .unwrap();

        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 100), // refresh is fresh; cooldown: 100-20=80 > 60 ✓
            info,
            ExecuteMsg::Deposit { proposal_id: 2 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::TotalBondedDeltaExceeded {});
    }

    // ── Test: anchor rate limit — understated total_bonded rejected ───────

    #[test]
    fn test_understated_total_bonded_via_anchor_rejected() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;

        // First activation: anchor at 10M
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Admin understates to 5M (-50%, exceeds ±10%)
        refresh_total_bonded(&mut deps, env_at(t0 + 100), 5_000_000);

        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        execute(
            deps.as_mut(),
            env_at(t0 + 100),
            info,
            ExecuteMsg::SubmitProposal {
                title: "Proposal 2".to_string(),
                description: "test".to_string(),
                messages: vec![],
            },
        )
        .unwrap();

        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 100), // cooldown: 100-20=80 > 60 ✓
            info,
            ExecuteMsg::Deposit { proposal_id: 2 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::TotalBondedDeltaExceeded {});
    }

    // ── Test: anchor rate limit — value within bounds accepted ────────────

    #[test]
    fn test_total_bonded_within_bounds_accepted() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000)]);

        let t0 = 1_000_000u64;

        // First activation: anchor at 10M
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Admin updates to 10.5M (+5%, within ±10%)
        refresh_total_bonded(&mut deps, env_at(t0 + 100), 10_500_000);

        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        execute(
            deps.as_mut(),
            env_at(t0 + 100),
            info,
            ExecuteMsg::SubmitProposal {
                title: "Proposal 2".to_string(),
                description: "test".to_string(),
                messages: vec![],
            },
        )
        .unwrap();

        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 100), // cooldown: 100-20=80 > 60 ✓; fresh: 0s < 300s ✓
            info,
            ExecuteMsg::Deposit { proposal_id: 2 },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "deposit");

        // Verify new anchor moved to 10.5M
        let prop: Proposal = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 100),
                QueryMsg::Proposal { proposal_id: 2 },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(prop.status, ProposalStatus::Active);
        assert_eq!(prop.snapshot_total_bonded, Uint128::from(10_500_000u128));
    }

    // ── Test: activation cooldown enforced ─────────────────────────────

    #[test]
    fn test_activation_cooldown_enforced() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;

        // First activation at t0+20
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);
        seed_anchor(&mut deps, env_at(t0));
        submit_proposal(&mut deps, env_at(t0 + 10));
        activate_proposal(&mut deps, env_at(t0 + 20), 1);

        // Keep total_bonded fresh and within bounds
        refresh_total_bonded(&mut deps, env_at(t0 + 30), 10_000_000);

        // Submit second proposal
        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        execute(
            deps.as_mut(),
            env_at(t0 + 30),
            info,
            ExecuteMsg::SubmitProposal {
                title: "Proposal 2".to_string(),
                description: "test".to_string(),
                messages: vec![],
            },
        )
        .unwrap();

        // Try to activate too soon (t0+50, only 30s after first activation)
        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 50), // 50-20=30s < 60s min_activation_gap
            info,
            ExecuteMsg::Deposit { proposal_id: 2 },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::ActivationCooldownNotElapsed {});

        // Re-refresh to keep fresh, then try after cooldown passes
        refresh_total_bonded(&mut deps, env_at(t0 + 80), 10_000_000);

        let info = mock_info(VOTER_A, &coins(500_000, DENOM));
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 85), // 85-20=65s > 60s ✓
            info,
            ExecuteMsg::Deposit { proposal_id: 2 },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "deposit");

        let prop: Proposal = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 85),
                QueryMsg::Proposal { proposal_id: 2 },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(prop.status, ProposalStatus::Active);
    }

    // ── Test: non-admin cannot seed anchor ─────────────────────────────

    #[test]
    fn test_non_admin_cannot_seed_anchor() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        let t0 = 1_000_000u64;
        refresh_total_bonded(&mut deps, env_at(t0), 10_000_000);

        let info = mock_info(VOTER_A, &[]);
        let err = execute(deps.as_mut(), env_at(t0), info, ExecuteMsg::SeedAnchor {}).unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    // ── Test: seed without UpdateTotalBonded fails ─────────────────────

    #[test]
    fn test_seed_without_total_bonded_fails() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps);

        // Try to seed anchor without ever calling UpdateTotalBonded
        let info = mock_info(ADMIN, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(1_000_000),
            info,
            ExecuteMsg::SeedAnchor {},
        )
        .unwrap_err();
        assert_eq!(err, ContractError::StaleTotalBonded {});
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Multi-feeder oracle tests
    // ═══════════════════════════════════════════════════════════════════════

    const FEEDER_1: &str = "feeder_1";
    const FEEDER_2: &str = "feeder_2";
    const FEEDER_3: &str = "feeder_3";
    const FEEDER_4: &str = "feeder_4";

    /// Set up a contract with 3-of-5 feeder quorum for multi-feeder tests,
    /// matching the Aethelred protocol's oracle configuration.
    fn setup_multi_feeder_contract(
        deps: &mut cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
    ) {
        let msg = InstantiateMsg {
            min_feeder_quorum: 3,
            feeder_tolerance_bps: 500, // 5%
            ..default_init_msg()
        };
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();

        // Admin is auto-registered as first feeder. Add four more → 5 total.
        for feeder in [FEEDER_1, FEEDER_2, FEEDER_3, FEEDER_4] {
            let info = mock_info(ADMIN, &[]);
            execute(
                deps.as_mut(),
                mock_env(),
                info,
                ExecuteMsg::AddFeeder {
                    address: feeder.to_string(),
                },
            )
            .unwrap();
        }
    }

    // ── Test: non-feeder cannot submit total_bonded ──────────────────────

    #[test]
    fn test_non_feeder_cannot_submit() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps);

        let info = mock_info("random_user", &[]);
        let err = execute(
            deps.as_mut(),
            env_at(1_000_000),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::NotAFeeder {});
    }

    // ── Test: single feeder submission does not reach 3-of-5 consensus ───

    #[test]
    fn test_single_feeder_no_consensus_in_multi_feeder_mode() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps);

        let t0 = 1_000_000u64;

        // Only admin submits — need 3, have 1
        let info = mock_info(ADMIN, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        // Consensus should NOT be reached
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "consensus_reached" && a.value == "false"));

        // Canonical TOTAL_BONDED should still be zero
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(bonded, Uint128::zero());
    }

    // ── Test: 3-of-5 feeders agree → consensus reached ──────────────────

    #[test]
    fn test_multi_feeder_consensus_reached() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps);

        let t0 = 1_000_000u64;

        // Feeder 1 submits 10M — need 3, have 1
        let info = mock_info(FEEDER_1, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "consensus_reached" && a.value == "false"));

        // Feeder 2 submits 10.1M — need 3, have 2
        let info = mock_info(FEEDER_2, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 5),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_100_000u128),
            },
        )
        .unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "consensus_reached" && a.value == "false"));

        // Admin submits 10.2M (within 5%) — now 3-of-5, consensus reached
        let info = mock_info(ADMIN, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 10),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_200_000u128),
            },
        )
        .unwrap();

        // 3-of-5 feeders agree within tolerance → consensus
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "consensus_reached" && a.value == "true"));

        // Median of sorted [10M, 10.1M, 10.2M] = 10.1M
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(bonded, Uint128::from(10_100_000u128));
    }

    // ── Test: 3-of-5 feeders agree → median is the middle value ───────────

    #[test]
    fn test_three_feeder_consensus_median() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps);

        let t0 = 1_000_000u64;

        // FEEDER_1: 10M
        let info = mock_info(FEEDER_1, &[]);
        execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        // ADMIN: 10.3M
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 5),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_300_000u128),
            },
        )
        .unwrap();

        // FEEDER_2: 10.1M
        let info = mock_info(FEEDER_2, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 10),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_100_000u128),
            },
        )
        .unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "consensus_reached" && a.value == "true"));

        // Median of [10M, 10.1M, 10.3M] = 10.1M
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(bonded, Uint128::from(10_100_000u128));
    }

    // ── Test: divergent submissions block consensus ──────────────────────

    #[test]
    fn test_multi_feeder_divergent_blocks_consensus() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps);

        let t0 = 1_000_000u64;

        // All 5 feeders submit but values are spread >5% apart — no 3-element
        // contiguous subset in sorted order will pass tolerance.
        // Sorted: [8M, 9M, 10M, 11M, 12M] — every adjacent pair >5% apart.
        for (feeder, value) in [
            (ADMIN, 10_000_000u128),
            (FEEDER_1, 8_000_000u128),
            (FEEDER_2, 12_000_000u128),
            (FEEDER_3, 9_000_000u128),
            (FEEDER_4, 11_000_000u128),
        ] {
            let info = mock_info(feeder, &[]);
            execute(
                deps.as_mut(),
                env_at(t0),
                info,
                ExecuteMsg::UpdateTotalBonded {
                    total_bonded: Uint128::from(value),
                },
            )
            .unwrap();
        }

        // No 3-element subset within 5% tolerance → no consensus
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(bonded, Uint128::zero());
    }

    // ── Test: stale feeder submission excluded from consensus ─────────────

    #[test]
    fn test_stale_feeder_submission_excluded() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps);

        let t0 = 1_000_000u64;

        // FEEDER_1 submits at t0 (will become stale after 300s)
        let info = mock_info(FEEDER_1, &[]);
        execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        // ADMIN submits at t0+400 — FEEDER_1's submission is now stale (>300s)
        let info = mock_info(ADMIN, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 400),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        // Only 1 fresh submission (ADMIN's), need 3 → no consensus
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "consensus_reached" && a.value == "false"));
    }

    // ── Test: add and remove feeders ─────────────────────────────────────

    #[test]
    fn test_add_remove_feeders() {
        let mut deps = mock_dependencies();
        setup_contract(&mut deps); // single-feeder mode

        // Admin adds a new feeder
        let info = mock_info(ADMIN, &[]);
        let res = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::AddFeeder {
                address: FEEDER_1.to_string(),
            },
        )
        .unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "total_feeders" && a.value == "2"));

        // Duplicate add fails
        let info = mock_info(ADMIN, &[]);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::AddFeeder {
                address: FEEDER_1.to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::FeederAlreadyRegistered {});

        // Non-admin cannot add feeders
        let info = mock_info(VOTER_A, &[]);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::AddFeeder {
                address: FEEDER_2.to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});

        // Admin removes a feeder
        let info = mock_info(ADMIN, &[]);
        let res = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::RemoveFeeder {
                address: FEEDER_1.to_string(),
            },
        )
        .unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "total_feeders" && a.value == "1"));

        // Removing non-existent feeder fails
        let info = mock_info(ADMIN, &[]);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::RemoveFeeder {
                address: FEEDER_3.to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::FeederNotFound {});
    }

    // ── Test: cannot remove feeders below min_feeder_quorum ──────────────
    // In multi-feeder mode (3-of-5), removing feeders until the count
    // reaches min_feeder_quorum must be blocked.

    #[test]
    fn test_cannot_remove_feeder_below_quorum() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps); // 5 feeders, min_quorum=3, cooldown=0

        // Remove FEEDER_4 → 4 remaining (4 > 3, OK)
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::RemoveFeeder {
                address: FEEDER_4.to_string(),
            },
        )
        .unwrap();

        // Remove FEEDER_3 → 3 remaining (exactly at quorum, OK)
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::RemoveFeeder {
                address: FEEDER_3.to_string(),
            },
        )
        .unwrap();

        // Remove FEEDER_2 → would drop to 2 (below quorum 3, BLOCKED)
        let info = mock_info(ADMIN, &[]);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::RemoveFeeder {
                address: FEEDER_2.to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::CannotRemoveBelowQuorum {});
    }

    // ── Test: feeder mutation cooldown blocks rapid add/remove ─────────
    // With a non-zero cooldown, the admin cannot perform two feeder
    // mutations within the cooldown window.

    #[test]
    fn test_feeder_mutation_cooldown_enforced() {
        let mut deps = mock_dependencies();

        // Custom setup: 1 feeder, 60s mutation cooldown, no quarantine
        let msg = InstantiateMsg {
            feeder_mutation_cooldown: 60,
            ..default_init_msg()
        };
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();

        let t0 = 1_000_000u64;

        // First add succeeds (LAST_FEEDER_MUTATION_TIME starts at epoch 0)
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::AddFeeder {
                address: FEEDER_1.to_string(),
            },
        )
        .unwrap();

        // Second add 30s later — blocked by 60s cooldown
        let info = mock_info(ADMIN, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 30),
            info,
            ExecuteMsg::AddFeeder {
                address: FEEDER_2.to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::FeederMutationCooldownNotElapsed {});

        // Remove at t0+30 also blocked by cooldown
        let info = mock_info(ADMIN, &[]);
        let err = execute(
            deps.as_mut(),
            env_at(t0 + 30),
            info,
            ExecuteMsg::RemoveFeeder {
                address: FEEDER_1.to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::FeederMutationCooldownNotElapsed {});

        // Add after cooldown elapses (t0+61) succeeds
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 61),
            info,
            ExecuteMsg::AddFeeder {
                address: FEEDER_2.to_string(),
            },
        )
        .unwrap();
    }

    // ── Test: quarantined feeder's submissions excluded from consensus ──
    // A freshly added feeder cannot influence consensus until the
    // quarantine period elapses, preventing the admin from adding aligned
    // feeders for immediate oracle steering.

    #[test]
    fn test_quarantined_feeder_submission_excluded() {
        let mut deps = mock_dependencies();

        // Custom setup: quorum=2, 5% tolerance, 300s quarantine, no cooldown
        let msg = InstantiateMsg {
            min_feeder_quorum: 2,
            feeder_tolerance_bps: 500,
            feeder_quarantine_period: 300,
            feeder_mutation_cooldown: 0,
            ..default_init_msg()
        };
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();

        let t0 = 2_000_000u64;

        // Add FEEDER_1 at t0 — quarantined until t0+300
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::AddFeeder {
                address: FEEDER_1.to_string(),
            },
        )
        .unwrap();

        // Admin submits 10M at t0+10
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 10),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        // FEEDER_1 submits 10.1M at t0+20 — but is quarantined
        let info = mock_info(FEEDER_1, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 20),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_100_000u128),
            },
        )
        .unwrap();

        // Consensus NOT reached — quarantined feeder's submission excluded,
        // only 1 eligible fresh value (admin) but need quorum=2
        assert!(
            res.attributes
                .iter()
                .any(|a| a.key == "consensus_reached" && a.value == "false"),
            "Quarantined feeder must not contribute to consensus"
        );

        // After quarantine expires (t0+301), feeder's next submission counts
        let info = mock_info(FEEDER_1, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 301),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_100_000u128),
            },
        )
        .unwrap();

        // Now we need admin's submission to also be fresh. Resubmit admin.
        let info = mock_info(ADMIN, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 302),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        // Consensus reached — both admin (not quarantined) and FEEDER_1
        // (quarantine elapsed) contribute fresh values
        assert!(
            res.attributes
                .iter()
                .any(|a| a.key == "consensus_reached" && a.value == "true"),
            "After quarantine expires, feeder must contribute to consensus"
        );
    }

    // ── Test: epoch invalidation prevents admin from steering oracle ─────
    // After removing a feeder, the oracle epoch increments. All prior
    // submissions (including the admin's own) are invalidated. The admin
    // cannot steer by removing a dissenter and resubmitting, because
    // they still need min_feeder_quorum independent feeders to re-submit
    // at the new epoch.

    #[test]
    fn test_epoch_invalidation_prevents_steering() {
        let mut deps = mock_dependencies();

        // Setup: 3 feeders, quorum=2, no cooldown/quarantine
        let msg = InstantiateMsg {
            min_feeder_quorum: 2,
            feeder_tolerance_bps: 500,
            ..default_init_msg()
        };
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();

        // Add FEEDER_1 and FEEDER_2
        for feeder in [FEEDER_1, FEEDER_2] {
            let info = mock_info(ADMIN, &[]);
            execute(
                deps.as_mut(),
                mock_env(),
                info,
                ExecuteMsg::AddFeeder {
                    address: feeder.to_string(),
                },
            )
            .unwrap();
        }
        // Total: 3 feeders (admin, FEEDER_1, FEEDER_2), quorum=2

        let t0 = 1_000_000u64;

        // All 3 feeders submit at epoch 0:
        //   admin=10M, FEEDER_1=10.1M, FEEDER_2=20M
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        let info = mock_info(FEEDER_1, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 1),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_100_000u128),
            },
        )
        .unwrap();

        let info = mock_info(FEEDER_2, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 2),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(20_000_000u128),
            },
        )
        .unwrap();

        // Consensus was reached from [10M, 10.1M] cluster → median 10.05M
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(bonded, Uint128::from(10_050_000u128));

        // Admin removes FEEDER_1 (the dissenter) → epoch increments to 1
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 5),
            info,
            ExecuteMsg::RemoveFeeder {
                address: FEEDER_1.to_string(),
            },
        )
        .unwrap();

        // Verify epoch incremented
        let epoch = ORACLE_EPOCH.load(deps.as_ref().storage).unwrap();
        assert_eq!(epoch, 1);

        // Admin resubmits 20.1M at epoch 1 (to align with FEEDER_2)
        let info = mock_info(ADMIN, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 10),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(20_100_000u128),
            },
        )
        .unwrap();

        // Consensus NOT reached! FEEDER_2's submission is still epoch 0
        // (stale by epoch), and admin is the only epoch-1 submission.
        // Need quorum=2 but only 1 current-epoch value → no consensus.
        assert!(
            res.attributes
                .iter()
                .any(|a| a.key == "consensus_reached" && a.value == "false"),
            "Admin alone cannot reach consensus after epoch increment"
        );

        // TOTAL_BONDED still at 10.05M — the admin could NOT steer it
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(
            bonded,
            Uint128::from(10_050_000u128),
            "TOTAL_BONDED must not change when admin is only epoch-current submitter"
        );

        // FEEDER_2 must independently re-submit at epoch 1 for consensus.
        // This is the key: the admin cannot unilaterally steer — they need
        // genuine agreement from at least one other feeder.
        let info = mock_info(FEEDER_2, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 15),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(20_000_000u128),
            },
        )
        .unwrap();

        // NOW consensus is reached: admin(20.1M) + FEEDER_2(20M) at epoch 1
        // Median of [20M, 20.1M] = 20.05M
        assert!(
            res.attributes
                .iter()
                .any(|a| a.key == "consensus_reached" && a.value == "true"),
            "Consensus should be reached once enough feeders re-submit at current epoch"
        );
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(bonded, Uint128::from(20_050_000u128));
    }

    // ── Test: oracle status query ────────────────────────────────────────

    #[test]
    fn test_oracle_status_query() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps);

        let t0 = 1_000_000u64;

        // 3 feeders submit (meets 3-of-5 quorum)
        let info = mock_info(FEEDER_1, &[]);
        execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        let info = mock_info(FEEDER_2, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 3),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_050_000u128),
            },
        )
        .unwrap();

        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 5),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_100_000u128),
            },
        )
        .unwrap();

        // Query oracle status
        let status: OracleStatusResponse =
            from_json(query(deps.as_ref(), env_at(t0 + 10), QueryMsg::OracleStatus {}).unwrap())
                .unwrap();

        assert_eq!(status.feeders.len(), 5); // admin + feeder_1..4
        assert_eq!(status.min_feeder_quorum, 3);
        assert_eq!(status.feeder_tolerance_bps, 500);
        // Consensus should be present (3 fresh submissions within tolerance)
        assert!(status.consensus_value.is_some());
    }

    // ── Test: multi-feeder full lifecycle (end-to-end) ───────────────────

    #[test]
    fn test_multi_feeder_full_lifecycle() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps);
        set_delegations(&mut deps, &[(VOTER_A, 5_000_000), (VOTER_B, 3_000_000)]);

        let t0 = 1_000_000u64;

        // 3 feeders submit total_bonded (need 3-of-5)
        let info = mock_info(FEEDER_1, &[]);
        execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        let info = mock_info(FEEDER_2, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 3),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_100_000u128),
            },
        )
        .unwrap();

        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 5),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_200_000u128),
            },
        )
        .unwrap();

        // Seed anchor (admin-only)
        seed_anchor(&mut deps, env_at(t0 + 10));

        // Submit and activate proposal
        submit_proposal(&mut deps, env_at(t0 + 20));
        activate_proposal(&mut deps, env_at(t0 + 30), 1);

        // Verify proposal activated with the consensus value
        let prop: Proposal = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 30),
                QueryMsg::Proposal { proposal_id: 1 },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(prop.status, ProposalStatus::Active);
        // Consensus median of sorted [10M, 10.1M, 10.2M] = 10.1M
        assert_eq!(prop.snapshot_total_bonded, Uint128::from(10_100_000u128));

        // Snapshot voters during window (t0+30 → t0+150)
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 50),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        let info = mock_info(VOTER_B, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 60),
            info,
            ExecuteMsg::SnapshotStake { proposal_id: 1 },
        )
        .unwrap();

        // Vote after snapshot window closes (t0+150)
        let info = mock_info(VOTER_A, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 200),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();

        let info = mock_info(VOTER_B, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 210),
            info,
            ExecuteMsg::Vote {
                proposal_id: 1,
                option: VoteOption::Yes,
            },
        )
        .unwrap();

        // Execute after voting ends
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 900),
            mock_info(VOTER_A, &[]),
            ExecuteMsg::ExecuteProposal { proposal_id: 1 },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "execute_proposal");

        let prop: Proposal = from_json(
            query(
                deps.as_ref(),
                env_at(t0 + 900),
                QueryMsg::Proposal { proposal_id: 1 },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(prop.status, ProposalStatus::Passed);
        assert!(prop.executed);
    }

    // ── Test: outlier feeders cannot veto honest consensus ───────────────
    // This is the core regression test for the P1 liveness fix.
    // With 3-of-5 quorum, three honest feeders agree while two submit
    // outliers. Consensus must still be reached via the agreeing subset.

    #[test]
    fn test_outlier_feeder_cannot_veto_consensus() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps); // 3-of-5, 5% tolerance

        let t0 = 1_000_000u64;

        // Three honest feeders: 10M, 10.1M, 10.2M (all within 5%)
        let info = mock_info(FEEDER_1, &[]);
        execute(
            deps.as_mut(),
            env_at(t0),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        let info = mock_info(FEEDER_2, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 3),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_100_000u128),
            },
        )
        .unwrap();

        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 5),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(10_200_000u128),
            },
        )
        .unwrap();

        // Two malicious/faulty feeders submit wild outliers
        let info = mock_info(FEEDER_3, &[]);
        execute(
            deps.as_mut(),
            env_at(t0 + 7),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(50_000_000u128),
            },
        )
        .unwrap();

        let info = mock_info(FEEDER_4, &[]);
        let res = execute(
            deps.as_mut(),
            env_at(t0 + 10),
            info,
            ExecuteMsg::UpdateTotalBonded {
                total_bonded: Uint128::from(1_000u128), // absurdly low
            },
        )
        .unwrap();

        // Consensus MUST still be reached — the sliding window finds the
        // 3-of-5 subset [10M, 10.1M, 10.2M] that agrees within tolerance.
        assert!(
            res.attributes
                .iter()
                .any(|a| a.key == "consensus_reached" && a.value == "true"),
            "Outlier feeders must not be able to veto consensus of honest feeders"
        );

        // Canonical value should be the median of the agreeing subset
        // Sorted honest subset: [10M, 10.1M, 10.2M] → median = 10.1M
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(bonded, Uint128::from(10_100_000u128));
    }

    // ── Test: even-sized window uses true median (arithmetic midpoint)
    // rather than the biased upper-middle element.
    //
    // 4 feeders submit [10M, 10.1M, 10.2M, 10.3M] — all within 5%.
    // Sorted window of size 4 → true median = (10.1M + 10.2M) / 2 = 10.15M.
    // Old code would pick window[2] = 10.2M (upper-biased).

    #[test]
    fn test_even_window_uses_true_median() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps); // 3-of-5, 5% tolerance

        let t0 = 1_000_000u64;

        // 4-of-5 feeders submit values within tolerance
        for (i, (feeder, value)) in [
            (FEEDER_1, 10_000_000u128),
            (FEEDER_2, 10_100_000u128),
            (FEEDER_3, 10_200_000u128),
            (FEEDER_4, 10_300_000u128),
        ]
        .iter()
        .enumerate()
        {
            let info = mock_info(feeder, &[]);
            execute(
                deps.as_mut(),
                env_at(t0 + i as u64),
                info,
                ExecuteMsg::UpdateTotalBonded {
                    total_bonded: Uint128::from(*value),
                },
            )
            .unwrap();
        }

        // With 4 fresh values, the largest qualifying window is size 4 (even).
        // True median = (10_100_000 + 10_200_000) / 2 = 10_150_000
        // NOT 10_200_000 (the upper-biased index-2 pick).
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(
            bonded,
            Uint128::from(10_150_000u128),
            "Even-sized window must use arithmetic midpoint, not upper-biased element"
        );
    }

    // ── Test: split-brain — two disjoint 3-feeder clusters both within
    // tolerance, but with different medians. When the 6th feeder completes
    // the second cluster, the ambiguity guard must fire: two equally valid
    // windows exist at window size 3, so the function returns None and
    // TOTAL_BONDED is NOT updated from that submission.
    //
    // Setup (3-of-5 quorum, 5% tolerance, 6 feeders):
    //   Cluster A: [10_000_000, 10_100_000, 10_200_000]  median = 10_100_000
    //   Cluster B: [20_000_000, 20_100_000, 20_200_000]  median = 20_100_000
    //
    // Submissions are interleaved A1,B1,A2,B2,A3,B3 to show temporal ordering.
    //   After A3 (5th feeder): only cluster A qualifies → consensus reached (10.1M)
    //   After B3 (6th feeder): BOTH clusters qualify → ambiguity guard → None
    //
    // The key assertion is that the 6th submission reports consensus_reached=false,
    // proving the ambiguity guard prevents sort-order bias from selecting a cluster.

    #[test]
    fn test_split_brain_two_clusters_rejects_consensus() {
        let mut deps = mock_dependencies();

        // Custom setup: 6 feeders, min_feeder_quorum=3, 5% tolerance
        let msg = InstantiateMsg {
            min_feeder_quorum: 3,
            feeder_tolerance_bps: 500,
            ..default_init_msg()
        };
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();

        // Add 5 extra feeders (admin is already feeder #1)
        let extra_feeders = [FEEDER_1, FEEDER_2, FEEDER_3, FEEDER_4, "feeder_5"];
        for feeder in extra_feeders {
            let info = mock_info(ADMIN, &[]);
            execute(
                deps.as_mut(),
                mock_env(),
                info,
                ExecuteMsg::AddFeeder {
                    address: feeder.to_string(),
                },
            )
            .unwrap();
        }
        // Total feeders: 6 (ADMIN, FEEDER_1..4, feeder_5)

        let t0 = 1_000_000u64;

        // Interleave submissions: A1, B1, A2, B2, A3, B3
        // This prevents either cluster from having all 3 members until
        // the 5th and 6th submissions respectively.
        let submissions = [
            (ADMIN, 10_000_000u128),      // A1
            (FEEDER_3, 20_000_000u128),   // B1
            (FEEDER_1, 10_100_000u128),   // A2
            (FEEDER_4, 20_100_000u128),   // B2
            (FEEDER_2, 10_200_000u128),   // A3 — completes cluster A (5 total values)
            ("feeder_5", 20_200_000u128), // B3 — completes cluster B (6 total values)
        ];

        let mut last_res = None;
        for (i, (feeder, value)) in submissions.iter().enumerate() {
            let info = mock_info(feeder, &[]);
            let res = execute(
                deps.as_mut(),
                env_at(t0 + i as u64),
                info,
                ExecuteMsg::UpdateTotalBonded {
                    total_bonded: Uint128::from(*value),
                },
            )
            .unwrap();
            last_res = Some(res);
        }

        // The 6th (final) submission must report consensus_reached=false.
        // At this point all 6 values are fresh:
        //   Sorted: [10M, 10.1M, 10.2M, 20M, 20.1M, 20.2M]
        //   Window size 3 yields two qualifying medians (10.1M and 20.1M)
        //   → ambiguity guard fires → None
        let res = last_res.unwrap();
        assert!(
            res.attributes
                .iter()
                .any(|a| a.key == "consensus_reached" && a.value == "false"),
            "Split-brain: the 6th submission must report consensus_reached=false \
             when two equally-sized qualifying clusters exist"
        );

        // TOTAL_BONDED was set to 10.1M by the 5th submission (when only
        // cluster A qualified). The 6th submission's ambiguity guard must
        // NOT overwrite it — TOTAL_BONDED should still be 10.1M, not 20.1M.
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(
            bonded,
            Uint128::from(10_100_000u128),
            "Ambiguity guard must not overwrite previously-set consensus value"
        );
    }

    // ── Test: all feeders divergent — no 3-element subset within tolerance ─

    #[test]
    fn test_all_feeders_divergent_no_consensus() {
        let mut deps = mock_dependencies();
        setup_multi_feeder_contract(&mut deps); // 3-of-5, 5% tolerance

        let t0 = 1_000_000u64;

        // All five feeders submit wildly different values.
        // Sorted: [5M, 10M, 20M, 30M, 50M] — no 3-element window within 5%.
        for (feeder, value) in [
            (ADMIN, 10_000_000u128),
            (FEEDER_1, 20_000_000u128),
            (FEEDER_2, 30_000_000u128),
            (FEEDER_3, 50_000_000u128),
            (FEEDER_4, 5_000_000u128),
        ] {
            let info = mock_info(feeder, &[]);
            execute(
                deps.as_mut(),
                env_at(t0),
                info,
                ExecuteMsg::UpdateTotalBonded {
                    total_bonded: Uint128::from(value),
                },
            )
            .unwrap();
        }

        // No 3-element subset within 5% tolerance → consensus fails
        let bonded = TOTAL_BONDED.load(deps.as_ref().storage).unwrap();
        assert_eq!(
            bonded,
            Uint128::zero(),
            "When all feeders diverge, consensus must fail"
        );
    }
}
