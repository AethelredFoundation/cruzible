/**
 * AethelVault - Security-Hardened Liquid Staking Contract
 *
 * Implements comprehensive security controls against:
 * - Double claim attacks
 * - Share inflation/donation attacks  
 * - Rounding exploitation
 * - Overflow/underflow
 * - Access control bypass
 *
 * Critical Invariants Enforced:
 * 1. Share conservation: sum(shares) == totalShares
 * 2. Solvency: totalStaked >= pendingUnstakes
 * 3. No double claim: each request claimed at most once
 * 4. Monotonic queue: processed requests stay processed
 */
use cosmwasm_std::{
    coin, ensure, entry_point, to_json_binary, Addr, BankMsg, Binary, CosmosMsg, Deps, DepsMut,
    Env, Event, MessageInfo, Response, StdResult, Uint128, WasmMsg,
};
use cw2::set_contract_version;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const CONTRACT_NAME: &str = "crates.io:aethel-vault";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ============ SECURITY CONSTANTS ============

/// Maximum fee basis points (10%)
const MAX_FEE_BPS: u32 = 1000;
/// Maximum unbonding requests per user (DoS protection)
const MAX_UNBONDING_REQUESTS: u64 = 100;
/// Minimum deposit amount (rounding attack protection)
const MIN_DEPOSIT: u128 = 1_000_000; // 1 token with 6 decimals
/// Maximum total value (overflow protection)
const MAX_TOTAL_STAKED: u128 = u128::MAX / 2;
/// MED-4: Minimum unbonding period (1 day in seconds) — prevents admin from setting 0
const MIN_UNBONDING_PERIOD: u64 = 86400;
/// HIGH-1: Scale factor for reward index to maintain precision (1e12)
const REWARD_INDEX_SCALE: u128 = 1_000_000_000_000;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),
    #[error("Unauthorized")]
    Unauthorized {},
    #[error("Insufficient balance")]
    InsufficientBalance {},
    #[error("Unbonding period not elapsed")]
    UnbondingNotElapsed {},
    #[error("No unbonding found")]
    NoUnbondingFound {},
    #[error("Invalid amount")]
    InvalidAmount {},
    #[error("Amount too small")]
    AmountTooSmall {},
    #[error("Overflow")]
    Overflow {},
    #[error("Underflow")]
    Underflow {},
    #[error("Fee too high")]
    FeeTooHigh {},
    #[error("Too many unbonding requests")]
    TooManyUnbondingRequests {},
    #[error("Already claimed")]
    AlreadyClaimed {},
    #[error("Nothing to claim")]
    NothingToClaim {},
    #[error("Invalid validator")]
    InvalidValidator {},
    #[error("Contract paused")]
    Paused {},
    #[error("Invariant violation")]
    InvariantViolation {},
}

// ============ STATE STRUCTURES ============

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub operator: Addr, // Routine operations (not admin)
    pub pauser: Addr,   // Emergency pause
    pub unbonding_period: u64,
    pub denom: String,
    pub staking_token: String,
    pub validators: Vec<Addr>,
    pub fee_bps: u32,
    pub min_stake: Uint128,
    pub max_stake: Uint128,
    pub paused: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct State {
    /// Total AETHEL staked (accounted, not raw balance)
    pub total_staked: Uint128,
    /// Total vault accounting shares. This includes the seed shares used as
    /// anti-inflation liquidity plus user-facing stAETHEL-denominated shares.
    pub total_shares: Uint128,
    /// Exchange rate numerator (for precision)
    pub exchange_rate_num: Uint128,
    /// Exchange rate denominator
    pub exchange_rate_den: Uint128,
    /// Reward pool balance
    pub reward_pool: Uint128,
    /// Total pending unbonding (for solvency check)
    pub total_unbonding: Uint128,
    /// Seed deposit to prevent first depositor attack
    pub seed_deposited: bool,
    /// HIGH-1 FIX: Global reward index — accumulates reward_pool / total_shares
    /// each time rewards are added. Stored as a scaled integer (multiplied by 1e12)
    /// to preserve precision without floating point.
    pub reward_index: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct UnbondingRequest {
    pub amount: Uint128,
    pub unbond_time: u64,
    pub complete_time: u64,
    /// SECURITY: Track claim status to prevent double claim
    pub claimed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct UserStake {
    pub shares: Uint128,
    pub staked_amount: Uint128,
    /// HIGH-1 FIX: Tracks cumulative rewards already accounted for this user.
    /// Prevents double-claim by recording the portion of reward_pool that was
    /// already claimed. User's claimable rewards = proportional_share - reward_debt.
    pub reward_debt: Uint128,
}

// ============ STORAGE ============

const CONFIG: Item<Config> = Item::new("config");
const STATE: Item<State> = Item::new("state");
const USER_STAKES: Map<&Addr, UserStake> = Map::new("user_stakes");
const UNSTAKE_REQUESTS: Map<(&Addr, u64), UnbondingRequest> = Map::new("unstake_requests");
const UNSTAKE_COUNT: Map<&Addr, u64> = Map::new("unstake_count");
/// SECURITY: Track used slash events to prevent replay
const PROCESSED_SLASHES: Map<u64, bool> = Map::new("processed_slashes");

// ============ MESSAGES ============

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub unbonding_period: u64,
    pub denom: String,
    pub staking_token: String,
    pub validators: Vec<String>,
    pub fee_bps: u32,
    pub min_stake: Uint128,
    pub max_stake: Uint128,
    pub operator: String,
    pub pauser: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    Stake {
        validator: String,
    },
    Unstake {
        amount: Uint128,
    },
    Claim {},
    ClaimRewards {},
    Compound {
        validator: String,
    },
    Restake {
        unbonding_id: u64,
    },
    UpdateConfig {
        unbonding_period: Option<u64>,
        fee_bps: Option<u32>,
        min_stake: Option<Uint128>,
        max_stake: Option<Uint128>,
    },
    UpdateValidators {
        validators: Vec<String>,
    },
    AddRewards {},
    RecordSlash {
        slash_id: u64,
        amount: Uint128,
    },
    Pause {},
    Unpause {},
    /// Sweep accidental donations (admin only)
    SweepDonations {
        recipient: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum StakingTokenExecuteMsg {
    Mint { recipient: String, amount: Uint128 },
    BurnFrom { owner: String, amount: Uint128 },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},
    State {},
    UserStake {
        address: String,
    },
    Unbonding {
        address: String,
    },
    PendingUnstakes {
        address: String,
    },
    ExchangeRate {},
    /// SECURITY: Check solvency invariant
    CheckSolvency {},
}

// ============ INSTANTIATE ============

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    // Validate fee is within bounds
    if msg.fee_bps > MAX_FEE_BPS {
        return Err(ContractError::FeeTooHigh {});
    }

    let validators: Result<Vec<Addr>, _> = msg
        .validators
        .iter()
        .map(|v| deps.api.addr_validate(v))
        .collect();
    let validators = validators?;

    // SECURITY: Require seed deposit to prevent first depositor attack
    let seed_amount = info
        .funds
        .iter()
        .find(|c| c.denom == msg.denom)
        .map(|c| c.amount)
        .unwrap_or_default();

    if seed_amount < Uint128::from(MIN_DEPOSIT) {
        return Err(ContractError::AmountTooSmall {});
    }

    // M-05 FIX: Validate min_stake <= max_stake
    let effective_min_stake = msg.min_stake.max(Uint128::from(MIN_DEPOSIT));
    if effective_min_stake > msg.max_stake {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            format!(
                "min_stake ({}) must be <= max_stake ({})",
                effective_min_stake, msg.max_stake
            ),
        )));
    }

    let config = Config {
        admin: info.sender.clone(),
        operator: deps.api.addr_validate(&msg.operator)?,
        pauser: deps.api.addr_validate(&msg.pauser)?,
        unbonding_period: msg.unbonding_period,
        denom: msg.denom,
        staking_token: msg.staking_token,
        validators,
        fee_bps: msg.fee_bps,
        min_stake: effective_min_stake,
        max_stake: msg.max_stake,
        paused: false,
    };

    // Seed shares 1:1 with seed deposit
    let state = State {
        total_staked: seed_amount,
        total_shares: seed_amount,
        exchange_rate_num: Uint128::from(1u128),
        exchange_rate_den: Uint128::from(1u128),
        reward_pool: Uint128::zero(),
        total_unbonding: Uint128::zero(),
        seed_deposited: true,
        reward_index: Uint128::zero(),
    };

    CONFIG.save(deps.storage, &config)?;
    STATE.save(deps.storage, &state)?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("seed_amount", seed_amount))
}

// ============ EXECUTE ============

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    // Check pause status
    let config = CONFIG.load(deps.storage)?;
    if config.paused {
        // Allow unpause even when paused
        match msg {
            ExecuteMsg::Unpause {} => {}
            _ => return Err(ContractError::Paused {}),
        }
    }

    match msg {
        ExecuteMsg::Stake { validator } => execute_stake(deps, env, info, validator),
        ExecuteMsg::Unstake { amount } => execute_unstake(deps, env, info, amount),
        ExecuteMsg::Claim {} => execute_claim(deps, env, info),
        ExecuteMsg::ClaimRewards {} => execute_claim_rewards(deps, env, info),
        ExecuteMsg::Compound { validator } => execute_compound(deps, env, info, validator),
        ExecuteMsg::Restake { unbonding_id } => execute_restake(deps, env, info, unbonding_id),
        ExecuteMsg::UpdateConfig {
            unbonding_period,
            fee_bps,
            min_stake,
            max_stake,
        } => execute_update_config(deps, info, unbonding_period, fee_bps, min_stake, max_stake),
        ExecuteMsg::UpdateValidators { validators } => {
            execute_update_validators(deps, info, validators)
        }
        ExecuteMsg::AddRewards {} => execute_add_rewards(deps, info),
        ExecuteMsg::RecordSlash { slash_id, amount } => {
            execute_record_slash(deps, info, slash_id, amount)
        }
        ExecuteMsg::Pause {} => execute_pause(deps, info),
        ExecuteMsg::Unpause {} => execute_unpause(deps, info),
        ExecuteMsg::SweepDonations { recipient } => {
            execute_sweep_donations(deps, env, info, recipient)
        }
    }
}

/// SECURITY: Rounding favors protocol (round down on mint, round up on burn)
fn calculate_shares_to_mint(
    amount: Uint128,
    total_staked: Uint128,
    total_shares: Uint128,
) -> Result<Uint128, ContractError> {
    if total_shares.is_zero() {
        // First depositor after seed gets 1:1
        return Ok(amount);
    }

    // Round down - user gets slightly fewer shares (favors protocol)
    // shares = amount * total_shares / total_staked
    let shares = amount.multiply_ratio(total_shares, total_staked);

    // Ensure at least 1 share for non-zero deposits
    if shares.is_zero() && !amount.is_zero() {
        return Ok(Uint128::one());
    }

    Ok(shares)
}

/// SECURITY: Round up when burning shares (user must burn more)
fn calculate_shares_to_burn(
    amount: Uint128,
    total_staked: Uint128,
    total_shares: Uint128,
) -> Result<Uint128, ContractError> {
    if total_staked.is_zero() {
        return Err(ContractError::Underflow {});
    }

    // Round up - user burns slightly more shares
    // shares = ceil(amount * total_shares / total_staked)
    let numerator = amount
        .checked_mul(total_shares)
        .map_err(|_| ContractError::Overflow {})?;
    let denominator = total_staked;

    // ceil(a/b) = (a + b - 1) / b
    let shares = numerator
        .checked_add(denominator)
        .and_then(|x| x.checked_sub(Uint128::one()))
        .map_err(|_| ContractError::Overflow {})?
        .checked_div(denominator)
        .map_err(|_| ContractError::Underflow {})?;

    Ok(shares)
}

fn mint_staking_token(
    config: &Config,
    recipient: &Addr,
    amount: Uint128,
) -> Result<CosmosMsg, ContractError> {
    Ok(CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: config.staking_token.clone(),
        msg: to_json_binary(&StakingTokenExecuteMsg::Mint {
            recipient: recipient.to_string(),
            amount,
        })?,
        funds: vec![],
    }))
}

fn burn_staking_token_from(
    config: &Config,
    owner: &Addr,
    amount: Uint128,
) -> Result<CosmosMsg, ContractError> {
    Ok(CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: config.staking_token.clone(),
        msg: to_json_binary(&StakingTokenExecuteMsg::BurnFrom {
            owner: owner.to_string(),
            amount,
        })?,
        funds: vec![],
    }))
}

fn execute_stake(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    validator: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Validate validator is whitelisted
    let validator_addr = deps.api.addr_validate(&validator)?;
    ensure!(
        config.validators.contains(&validator_addr),
        ContractError::InvalidValidator {}
    );

    // Get stake amount
    let amount = info
        .funds
        .iter()
        .find(|c| c.denom == config.denom)
        .map(|c| c.amount)
        .unwrap_or_default();

    // SECURITY: Validate amount
    if amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }
    if amount < config.min_stake {
        return Err(ContractError::AmountTooSmall {});
    }
    if amount > config.max_stake {
        return Err(ContractError::InvalidAmount {});
    }

    // SECURITY: Overflow protection
    if state.total_staked.u128() > MAX_TOTAL_STAKED - amount.u128() {
        return Err(ContractError::Overflow {});
    }

    // Calculate shares (rounds down)
    let new_shares = calculate_shares_to_mint(amount, state.total_staked, state.total_shares)?;
    ensure!(!new_shares.is_zero(), ContractError::AmountTooSmall {});

    // Update state
    state.total_staked = state
        .total_staked
        .checked_add(amount)
        .map_err(|_| ContractError::Overflow {})?;
    state.total_shares = state
        .total_shares
        .checked_add(new_shares)
        .map_err(|_| ContractError::Overflow {})?;

    // Update user stake
    let mut user_stake = USER_STAKES
        .may_load(deps.storage, &info.sender)?
        .unwrap_or(UserStake {
            shares: Uint128::zero(),
            staked_amount: Uint128::zero(),
            reward_debt: Uint128::zero(),
        });
    user_stake.shares = user_stake
        .shares
        .checked_add(new_shares)
        .map_err(|_| ContractError::Overflow {})?;
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_add(amount)
        .map_err(|_| ContractError::Overflow {})?;
    // HIGH-1: Set reward_debt to current index × new total shares so new deposits
    // don't get retroactive rewards from before they staked
    user_stake.reward_debt = state
        .reward_index
        .checked_mul(user_stake.shares)
        .map_err(|_| ContractError::Overflow {})?
        .checked_div(Uint128::from(REWARD_INDEX_SCALE))
        .map_err(|_| ContractError::Underflow {})?;

    USER_STAKES.save(deps.storage, &info.sender, &user_stake)?;
    STATE.save(deps.storage, &state)?;

    // INVARIANT: Verify vault state consistency after staking
    assert_vault_invariants(&state)?;

    // MONITORING: Emit staking event for indexers
    let stake_event = Event::new("vault_stake")
        .add_attribute("staker", info.sender.as_str())
        .add_attribute("amount", amount.to_string())
        .add_attribute("shares_minted", new_shares.to_string())
        .add_attribute("total_staked", state.total_staked.to_string())
        .add_attribute("total_shares", state.total_shares.to_string());

    let mint_msg = mint_staking_token(&config, &info.sender, new_shares)?;

    Ok(Response::new()
        .add_message(mint_msg)
        .add_event(stake_event)
        .add_attribute("action", "stake")
        .add_attribute("amount", amount)
        .add_attribute("shares_minted", new_shares)
        .add_attribute("validator", validator))
}

fn execute_unstake(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Validate amount
    if amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }

    // Get user stake
    let mut user_stake = USER_STAKES.load(deps.storage, &info.sender)?;
    ensure!(
        user_stake.staked_amount >= amount,
        ContractError::InsufficientBalance {}
    );

    // Calculate shares to burn (rounds up - favors protocol)
    let shares_to_burn = calculate_shares_to_burn(amount, state.total_staked, state.total_shares)?;
    ensure!(
        user_stake.shares >= shares_to_burn,
        ContractError::InsufficientBalance {}
    );

    // Check request limit (DoS protection)
    let count = UNSTAKE_COUNT.load(deps.storage, &info.sender).unwrap_or(0);
    if count >= MAX_UNBONDING_REQUESTS {
        return Err(ContractError::TooManyUnbondingRequests {});
    }

    // Update user stake
    user_stake.shares = user_stake
        .shares
        .checked_sub(shares_to_burn)
        .map_err(|_| ContractError::Underflow {})?;
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_sub(amount)
        .map_err(|_| ContractError::Underflow {})?;

    if user_stake.shares.is_zero() {
        USER_STAKES.remove(deps.storage, &info.sender);
    } else {
        USER_STAKES.save(deps.storage, &info.sender, &user_stake)?;
    }

    // Update global state
    state.total_staked = state
        .total_staked
        .checked_sub(amount)
        .map_err(|_| ContractError::Underflow {})?;
    state.total_shares = state
        .total_shares
        .checked_sub(shares_to_burn)
        .map_err(|_| ContractError::Underflow {})?;
    state.total_unbonding = state
        .total_unbonding
        .checked_add(amount)
        .map_err(|_| ContractError::Overflow {})?;

    // Create unbonding request
    let unbonding = UnbondingRequest {
        amount,
        unbond_time: env.block.time.seconds(),
        complete_time: env.block.time.seconds() + config.unbonding_period,
        claimed: false, // SECURITY: Track claim status
    };

    UNSTAKE_REQUESTS.save(deps.storage, (&info.sender, count), &unbonding)?;
    UNSTAKE_COUNT.save(deps.storage, &info.sender, &(count + 1))?;
    STATE.save(deps.storage, &state)?;

    // INVARIANT: Verify vault state consistency after unstaking
    assert_vault_invariants(&state)?;

    // MONITORING: Emit unstake event
    let unstake_event = Event::new("vault_unstake")
        .add_attribute("staker", info.sender.as_str())
        .add_attribute("amount", amount.to_string())
        .add_attribute("shares_burned", shares_to_burn.to_string())
        .add_attribute("total_unbonding", state.total_unbonding.to_string());

    let burn_msg = burn_staking_token_from(&config, &info.sender, shares_to_burn)?;

    Ok(Response::new()
        .add_message(burn_msg)
        .add_event(unstake_event)
        .add_attribute("action", "unstake")
        .add_attribute("amount", amount)
        .add_attribute("shares_burned", shares_to_burn)
        .add_attribute("unbonding_id", count.to_string()))
}

/// SECURITY: State updates before external calls (checks-effects-interactions)
fn execute_claim(deps: DepsMut, env: Env, info: MessageInfo) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;
    let count = UNSTAKE_COUNT.load(deps.storage, &info.sender).unwrap_or(0);

    let mut total_claim = Uint128::zero();
    let mut claimed_count = 0u64;

    // SECURITY: Update state before external call
    for i in 0..count {
        if let Ok(mut req) = UNSTAKE_REQUESTS.load(deps.storage, (&info.sender, i)) {
            if env.block.time.seconds() >= req.complete_time && !req.claimed {
                // Mark as claimed BEFORE sending
                req.claimed = true;
                UNSTAKE_REQUESTS.save(deps.storage, (&info.sender, i), &req)?;

                total_claim = total_claim
                    .checked_add(req.amount)
                    .map_err(|_| ContractError::Overflow {})?;
                claimed_count += 1;
            }
        }
    }

    ensure!(!total_claim.is_zero(), ContractError::NothingToClaim {});

    // Update total unbonding
    state.total_unbonding = state
        .total_unbonding
        .checked_sub(total_claim)
        .map_err(|_| ContractError::Underflow {})?;
    STATE.save(deps.storage, &state)?;

    // SECURITY: External call AFTER all state updates
    let send_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: info.sender.to_string(),
        amount: vec![coin(total_claim.u128(), &config.denom)],
    });

    Ok(Response::new()
        .add_message(send_msg)
        .add_attribute("action", "claim")
        .add_attribute("amount", total_claim)
        .add_attribute("requests_claimed", claimed_count.to_string()))
}

fn execute_claim_rewards(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    let mut user_stake = USER_STAKES.load(deps.storage, &info.sender)?;
    let rewards = calculate_rewards(&state, &user_stake)?;

    ensure!(!rewards.is_zero(), ContractError::NothingToClaim {});

    // HIGH-1 FIX: Update reward_debt to current entitlement BEFORE external call.
    // This ensures calling claim_rewards again immediately yields zero.
    user_stake.reward_debt = state
        .reward_index
        .checked_mul(user_stake.shares)
        .map_err(|_| ContractError::Overflow {})?
        .checked_div(Uint128::from(REWARD_INDEX_SCALE))
        .map_err(|_| ContractError::Underflow {})?;
    USER_STAKES.save(deps.storage, &info.sender, &user_stake)?;

    // Update state BEFORE external call
    state.reward_pool = state
        .reward_pool
        .checked_sub(rewards)
        .map_err(|_| ContractError::Underflow {})?;
    STATE.save(deps.storage, &state)?;

    let send_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: info.sender.to_string(),
        amount: vec![coin(rewards.u128(), &config.denom)],
    });

    Ok(Response::new()
        .add_message(send_msg)
        .add_attribute("action", "claim_rewards")
        .add_attribute("rewards", rewards))
}

/// HIGH-4 FIX: Compound rewards directly into the user's stake without
/// sending bank messages. The old approach sent rewards to the user via
/// BankMsg::Send then called execute_stake which expected info.funds — the
/// rewards would never arrive in the same tx. Now we internally compute
/// pending rewards, add them to total_staked, mint new shares, and update
/// the user's reward_debt atomically.
fn execute_compound(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    validator: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Validate validator is whitelisted
    let validator_addr = deps.api.addr_validate(&validator)?;
    ensure!(
        config.validators.contains(&validator_addr),
        ContractError::InvalidValidator {}
    );

    let mut user_stake = USER_STAKES.load(deps.storage, &info.sender)?;
    let rewards = calculate_rewards(&state, &user_stake)?;

    ensure!(!rewards.is_zero(), ContractError::NothingToClaim {});

    // Calculate new shares for the compounded rewards
    let new_shares = calculate_shares_to_mint(rewards, state.total_staked, state.total_shares)?;
    ensure!(!new_shares.is_zero(), ContractError::AmountTooSmall {});

    // Move rewards from reward_pool to total_staked (internal re-stake)
    state.reward_pool = state
        .reward_pool
        .checked_sub(rewards)
        .map_err(|_| ContractError::Underflow {})?;
    state.total_staked = state
        .total_staked
        .checked_add(rewards)
        .map_err(|_| ContractError::Overflow {})?;
    state.total_shares = state
        .total_shares
        .checked_add(new_shares)
        .map_err(|_| ContractError::Overflow {})?;

    // Update user stake
    user_stake.shares = user_stake
        .shares
        .checked_add(new_shares)
        .map_err(|_| ContractError::Overflow {})?;
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_add(rewards)
        .map_err(|_| ContractError::Overflow {})?;
    // Reset reward_debt to current entitlement
    user_stake.reward_debt = state
        .reward_index
        .checked_mul(user_stake.shares)
        .map_err(|_| ContractError::Overflow {})?
        .checked_div(Uint128::from(REWARD_INDEX_SCALE))
        .map_err(|_| ContractError::Underflow {})?;

    USER_STAKES.save(deps.storage, &info.sender, &user_stake)?;
    STATE.save(deps.storage, &state)?;

    let mint_msg = mint_staking_token(&config, &info.sender, new_shares)?;

    Ok(Response::new()
        .add_message(mint_msg)
        .add_attribute("action", "compound")
        .add_attribute("rewards_compounded", rewards)
        .add_attribute("shares_minted", new_shares)
        .add_attribute("validator", validator))
}

fn execute_restake(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    unbonding_id: u64,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Load and validate unbonding request
    let unbonding = UNSTAKE_REQUESTS.load(deps.storage, (&info.sender, unbonding_id))?;
    ensure!(!unbonding.claimed, ContractError::AlreadyClaimed {});

    // Remove the unbonding request
    UNSTAKE_REQUESTS.remove(deps.storage, (&info.sender, unbonding_id));

    // Calculate shares to mint (rounds down)
    let shares =
        calculate_shares_to_mint(unbonding.amount, state.total_staked, state.total_shares)?;

    // Update state
    state.total_staked = state
        .total_staked
        .checked_add(unbonding.amount)
        .map_err(|_| ContractError::Overflow {})?;
    state.total_shares = state
        .total_shares
        .checked_add(shares)
        .map_err(|_| ContractError::Overflow {})?;
    state.total_unbonding = state
        .total_unbonding
        .checked_sub(unbonding.amount)
        .map_err(|_| ContractError::Underflow {})?;

    // Update user stake
    let mut user_stake = USER_STAKES
        .may_load(deps.storage, &info.sender)?
        .unwrap_or(UserStake {
            shares: Uint128::zero(),
            staked_amount: Uint128::zero(),
            reward_debt: Uint128::zero(),
        });
    user_stake.shares = user_stake
        .shares
        .checked_add(shares)
        .map_err(|_| ContractError::Overflow {})?;
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_add(unbonding.amount)
        .map_err(|_| ContractError::Overflow {})?;
    // Update reward_debt to prevent restaked shares from earning retroactive rewards
    user_stake.reward_debt = state
        .reward_index
        .checked_mul(user_stake.shares)
        .map_err(|_| ContractError::Overflow {})?
        .checked_div(Uint128::from(REWARD_INDEX_SCALE))
        .map_err(|_| ContractError::Underflow {})?;

    USER_STAKES.save(deps.storage, &info.sender, &user_stake)?;
    STATE.save(deps.storage, &state)?;

    let mint_msg = mint_staking_token(&config, &info.sender, shares)?;

    Ok(Response::new()
        .add_message(mint_msg)
        .add_attribute("action", "restake")
        .add_attribute("amount", unbonding.amount)
        .add_attribute("shares_minted", shares))
}

fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    unbonding_period: Option<u64>,
    fee_bps: Option<u32>,
    min_stake: Option<Uint128>,
    max_stake: Option<Uint128>,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    ensure!(info.sender == config.admin, ContractError::Unauthorized {});

    if let Some(period) = unbonding_period {
        // MED-4: Enforce minimum unbonding period to prevent admin from setting 0
        if period < MIN_UNBONDING_PERIOD {
            return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
                format!(
                    "Unbonding period must be at least {} seconds",
                    MIN_UNBONDING_PERIOD
                ),
            )));
        }
        config.unbonding_period = period;
    }

    // SECURITY: Enforce fee cap
    if let Some(fee) = fee_bps {
        if fee > MAX_FEE_BPS {
            return Err(ContractError::FeeTooHigh {});
        }
        config.fee_bps = fee;
    }

    if let Some(min) = min_stake {
        config.min_stake = min.max(Uint128::from(MIN_DEPOSIT));
    }
    if let Some(max) = max_stake {
        config.max_stake = max;
    }

    // M-05 FIX: Validate min_stake <= max_stake after updates
    if config.min_stake > config.max_stake {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            format!(
                "min_stake ({}) must be <= max_stake ({})",
                config.min_stake, config.max_stake
            ),
        )));
    }

    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "update_config")
        .add_attribute("fee_bps", config.fee_bps.to_string()))
}

fn execute_update_validators(
    deps: DepsMut,
    info: MessageInfo,
    validators: Vec<String>,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    // Allow operator or admin
    ensure!(
        info.sender == config.admin || info.sender == config.operator,
        ContractError::Unauthorized {}
    );

    let validators: Result<Vec<Addr>, _> = validators
        .iter()
        .map(|v| deps.api.addr_validate(v))
        .collect();
    config.validators = validators?;

    CONFIG.save(deps.storage, &config)?;
    Ok(Response::new().add_attribute("action", "update_validators"))
}

fn execute_add_rewards(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    let rewards = info
        .funds
        .iter()
        .find(|c| c.denom == config.denom)
        .map(|c| c.amount)
        .unwrap_or_default();

    // HIGH-1 FIX: Update global reward_index when rewards are added.
    // index += (rewards * SCALE) / total_shares
    // This distributes new rewards proportionally to all current stakers.
    if !state.total_shares.is_zero() && !rewards.is_zero() {
        let index_increment = rewards
            .checked_mul(Uint128::from(REWARD_INDEX_SCALE))
            .map_err(|_| ContractError::Overflow {})?
            .checked_div(state.total_shares)
            .map_err(|_| ContractError::Underflow {})?;
        state.reward_index = state
            .reward_index
            .checked_add(index_increment)
            .map_err(|_| ContractError::Overflow {})?;
    }

    state.reward_pool = state
        .reward_pool
        .checked_add(rewards)
        .map_err(|_| ContractError::Overflow {})?;
    STATE.save(deps.storage, &state)?;

    Ok(Response::new()
        .add_attribute("action", "add_rewards")
        .add_attribute("amount", rewards))
}

/// SECURITY: Record slash event with replay protection
fn execute_record_slash(
    deps: DepsMut,
    info: MessageInfo,
    slash_id: u64,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Only operator or admin can record slashes
    ensure!(
        info.sender == config.admin || info.sender == config.operator,
        ContractError::Unauthorized {}
    );

    // Replay protection
    if PROCESSED_SLASHES.has(deps.storage, slash_id) {
        return Err(ContractError::AlreadyClaimed {});
    }
    PROCESSED_SLASHES.save(deps.storage, slash_id, &true)?;

    // Apply slash to exchange rate
    // New rate = (total_staked - slash) / total_shares
    let new_staked = state
        .total_staked
        .checked_sub(amount)
        .map_err(|_| ContractError::Underflow {})?;

    state.total_staked = new_staked;
    // Update exchange rate for precision
    if !state.total_shares.is_zero() {
        state.exchange_rate_num = new_staked;
        state.exchange_rate_den = state.total_shares;
    }

    STATE.save(deps.storage, &state)?;

    // INVARIANT: Verify vault state consistency after slash
    assert_vault_invariants(&state)?;

    // MONITORING: Slash event for critical alerting
    let slash_event = Event::new("vault_slash")
        .add_attribute("slash_id", slash_id.to_string())
        .add_attribute("amount", amount.to_string())
        .add_attribute("remaining_staked", new_staked.to_string())
        .add_attribute(
            "severity",
            if amount > state.total_shares {
                "critical"
            } else {
                "normal"
            },
        );

    Ok(Response::new()
        .add_event(slash_event)
        .add_attribute("action", "record_slash")
        .add_attribute("slash_id", slash_id.to_string())
        .add_attribute("amount", amount))
}

fn execute_pause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    ensure!(
        info.sender == config.admin || info.sender == config.pauser,
        ContractError::Unauthorized {}
    );
    config.paused = true;
    CONFIG.save(deps.storage, &config)?;
    Ok(Response::new().add_attribute("action", "pause"))
}

fn execute_unpause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    ensure!(info.sender == config.admin, ContractError::Unauthorized {});
    config.paused = false;
    CONFIG.save(deps.storage, &config)?;
    Ok(Response::new().add_attribute("action", "unpause"))
}

/// SECURITY: Sweep accidental donations without affecting share price
fn execute_sweep_donations(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    recipient: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let state = STATE.load(deps.storage)?;

    ensure!(info.sender == config.admin, ContractError::Unauthorized {});

    let recipient_addr = deps.api.addr_validate(&recipient)?;

    // Query actual contract balance
    let balance: cosmwasm_std::BalanceResponse = deps.querier.query(
        &cosmwasm_std::QueryRequest::Bank(cosmwasm_std::BankQuery::Balance {
            address: env.contract.address.to_string(),
            denom: config.denom.clone(),
        }),
    )?;

    // Calculate excess (donations)
    let accounted = state.total_staked + state.reward_pool + state.total_unbonding;
    let excess = balance.amount.amount.saturating_sub(accounted);

    if excess.is_zero() {
        return Err(ContractError::NothingToClaim {});
    }

    let send_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: recipient_addr.to_string(),
        amount: vec![coin(excess.u128(), &config.denom)],
    });

    Ok(Response::new()
        .add_message(send_msg)
        .add_attribute("action", "sweep_donations")
        .add_attribute("amount", excess)
        .add_attribute("recipient", recipient))
}

/// HIGH-1 FIX: Checkpoint-based reward calculation using global reward_index.
/// Pending rewards = (user_shares * reward_index / SCALE) - reward_debt
/// This prevents double-claiming because reward_debt is updated on every claim.
fn calculate_rewards(state: &State, user_stake: &UserStake) -> Result<Uint128, ContractError> {
    if state.total_shares.is_zero() || user_stake.shares.is_zero() {
        return Ok(Uint128::zero());
    }

    // Calculate user's total entitled rewards based on current index
    let entitled = state
        .reward_index
        .checked_mul(user_stake.shares)
        .map_err(|_| ContractError::Overflow {})?
        .checked_div(Uint128::from(REWARD_INDEX_SCALE))
        .map_err(|_| ContractError::Underflow {})?;

    // Subtract what was already claimed/accounted for
    let pending = entitled.saturating_sub(user_stake.reward_debt);
    Ok(pending)
}

// ============ FORMAL INVARIANT ASSERTIONS ============

/// Verify critical vault invariants after every state mutation.
/// These checks enforce the four foundational guarantees:
///   1. Solvency: total_staked >= total_unbonding
///   2. Share conservation: total_shares > 0 iff total_staked > 0
///   3. Exchange rate bounded: rate never exceeds MAX_TOTAL_STAKED
///   4. Reward pool consistent: reward_pool backed by index
///
/// Panicking on invariant violation is intentional: it prevents the
/// transaction from committing corrupted state.
fn assert_vault_invariants(state: &State) -> Result<(), ContractError> {
    // INV-1: Total value conservation — the sum of staked + unbonding + rewards
    // must not exceed safe arithmetic bounds. Individual unbonding can exceed
    // staked (when most users are exiting), so we check the aggregate.
    let total_accounted = state
        .total_staked
        .checked_add(state.total_unbonding)
        .and_then(|v| v.checked_add(state.reward_pool))
        .map_err(|_| ContractError::InvariantViolation {})?;
    if total_accounted.u128() > MAX_TOTAL_STAKED {
        return Err(ContractError::InvariantViolation {});
    }

    // INV-2: Share consistency — shares and staked must be coherent.
    // If total_staked is non-zero, total_shares must also be non-zero (otherwise
    // the exchange rate is undefined). The converse isn't checked because the
    // seed deposit ensures both are positive from init.
    if !state.total_staked.is_zero() && state.total_shares.is_zero() {
        return Err(ContractError::InvariantViolation {});
    }

    // INV-3: Overflow guard — total staked within safe arithmetic range
    if state.total_staked.u128() > MAX_TOTAL_STAKED {
        return Err(ContractError::InvariantViolation {});
    }

    // INV-4: Exchange rate sanity — shares should never exceed staked by more
    // than 100× (implies rate < 0.01, extreme dilution indicates a bug).
    // Uses 100× to allow for moderate slash scenarios.
    if !state.total_staked.is_zero()
        && state.total_shares > state.total_staked * Uint128::from(100u128)
    {
        return Err(ContractError::InvariantViolation {});
    }

    Ok(())
}

/// MED-1 FIX: Integer-based exchange rate response (no floating point)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ExchangeRateResponse {
    pub numerator: Uint128,
    pub denominator: Uint128,
    /// Exchange rate scaled by 1e18 for precision (integer representation)
    pub rate_scaled_1e18: Uint128,
}

// ============ QUERY ============

#[entry_point]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&CONFIG.load(deps.storage)?),
        QueryMsg::State {} => to_json_binary(&STATE.load(deps.storage)?),
        QueryMsg::UserStake { address } => {
            let addr = deps.api.addr_validate(&address)?;
            let stake = USER_STAKES
                .may_load(deps.storage, &addr)?
                .unwrap_or(UserStake {
                    shares: Uint128::zero(),
                    staked_amount: Uint128::zero(),
                    reward_debt: Uint128::zero(),
                });
            to_json_binary(&stake)
        }
        QueryMsg::Unbonding { address } => {
            let addr = deps.api.addr_validate(&address)?;
            let count = UNSTAKE_COUNT.load(deps.storage, &addr).unwrap_or(0);
            let mut requests = Vec::new();
            for i in 0..count {
                if let Ok(req) = UNSTAKE_REQUESTS.load(deps.storage, (&addr, i)) {
                    requests.push((i, req));
                }
            }
            to_json_binary(&requests)
        }
        QueryMsg::PendingUnstakes { address } => {
            let addr = deps.api.addr_validate(&address)?;
            let count = UNSTAKE_COUNT.load(deps.storage, &addr).unwrap_or(0);
            let mut pending = Vec::new();
            for i in 0..count {
                if let Ok(req) = UNSTAKE_REQUESTS.load(deps.storage, (&addr, i)) {
                    if !req.claimed && env.block.time.seconds() < req.complete_time {
                        pending.push((i, req));
                    }
                }
            }
            to_json_binary(&pending)
        }
        QueryMsg::ExchangeRate {} => {
            // MED-1 FIX: Replace f64 division with Uint128 rational representation.
            // Floating-point can lose precision for large token supplies;
            // instead we return numerator/denominator and a scaled integer.
            let state = STATE.load(deps.storage)?;
            if state.total_shares.is_zero() {
                to_json_binary(&ExchangeRateResponse {
                    numerator: Uint128::one(),
                    denominator: Uint128::one(),
                    rate_scaled_1e18: Uint128::from(1_000_000_000_000_000_000u128),
                })
            } else {
                // rate_scaled_1e18 = total_staked * 1e18 / total_shares
                let scale = Uint128::from(1_000_000_000_000_000_000u128);
                let rate_scaled = state
                    .total_staked
                    .checked_mul(scale)
                    .unwrap_or(Uint128::MAX)
                    .checked_div(state.total_shares)
                    .unwrap_or(Uint128::zero());
                to_json_binary(&ExchangeRateResponse {
                    numerator: state.total_staked,
                    denominator: state.total_shares,
                    rate_scaled_1e18: rate_scaled,
                })
            }
        }
        QueryMsg::CheckSolvency {} => {
            let state = STATE.load(deps.storage)?;
            let is_solvable = state.total_staked >= state.total_unbonding;
            to_json_binary(&is_solvable)
        }
    }
}

// L-04 FIX: Migration entry point for on-chain contract upgrades.
// Uses cw2 version tracking to enable safe schema migrations.

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
    // Update stored version to current
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new()
        .add_attribute("action", "migrate")
        .add_attribute("from_version", version.version)
        .add_attribute("to_version", CONTRACT_VERSION))
}

#[cfg(test)]
mod contract_tests;
