/**
 * CW20 Staking Token (stAETHEL)
 * 
 * Liquid staking token representing staked AETHEL.
 * Implements the CW20 standard for compatibility with DeFi protocols.
 */

use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
    StdError, Addr, Uint128, WasmMsg, Event,
};
use cw2::set_contract_version;
use cw_storage_plus::{Bound, Item, Map};
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use thiserror::Error;

const CONTRACT_NAME: &str = "crates.io:cw20-staking";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),
    #[error("Unauthorized")]
    Unauthorized {},
    #[error("Cannot set to own account")]
    CannotSetOwnAccount {},
    #[error("Invalid zero amount")]
    InvalidZeroAmount {},
    #[error("Allowance is expired")]
    Expired {},
    #[error("No allowance for this spender")]
    NoAllowance {},
    #[error("Cannot exceed max supply")]
    CannotExceedCap {},
    #[error("Cannot transfer to self")]
    CannotTransferToSelf {},
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TokenInfo {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: Uint128,
    pub mint: Option<MinterData>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MinterData {
    pub minter: Addr,
    pub cap: Option<Uint128>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct BalanceResponse {
    pub balance: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TokenInfoResponse {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AllowanceResponse {
    pub allowance: Uint128,
    pub expires: Expiration,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Expiration {
    AtHeight(u64),
    AtTime(u64),
    Never {},
}

const TOKEN_INFO: Item<TokenInfo> = Item::new("token_info");
const BALANCES: Map<&Addr, Uint128> = Map::new("balances");
const ALLOWANCES: Map<(&Addr, &Addr), AllowanceInfo> = Map::new("allowances");

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AllowanceInfo {
    pub allowance: Uint128,
    pub expires: Expiration,
}

impl Default for AllowanceInfo {
    fn default() -> Self {
        Self {
            allowance: Uint128::zero(),
            expires: Expiration::Never {},
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub initial_supply: Uint128,
    pub minter: String,
    pub cap: Option<Uint128>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    /// Transfer tokens to another address
    Transfer {
        recipient: String,
        amount: Uint128,
    },
    /// Burn tokens
    Burn {
        amount: Uint128,
    },
    /// Mint new tokens (minter only)
    Mint {
        recipient: String,
        amount: Uint128,
    },
    /// Approve spender
    IncreaseAllowance {
        spender: String,
        amount: Uint128,
        expires: Option<Expiration>,
    },
    /// Decrease allowance
    DecreaseAllowance {
        spender: String,
        amount: Uint128,
        expires: Option<Expiration>,
    },
    /// Transfer from allowance
    TransferFrom {
        owner: String,
        recipient: String,
        amount: Uint128,
    },
    /// Burn from allowance
    BurnFrom {
        owner: String,
        amount: Uint128,
    },
    /// Send tokens with callback
    Send {
        contract: String,
        amount: Uint128,
        msg: Binary,
    },
    /// Update marketing info
    UpdateMinter {
        new_minter: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    /// Get token info
    TokenInfo {},
    /// Get balance of address
    Balance { address: String },
    /// Get allowance
    Allowance { owner: String, spender: String },
    /// Get minter
    Minter {},
    /// List all allowances for an owner
    AllAllowances {
        owner: String,
        start_after: Option<String>,
        limit: Option<u32>,
    },
    /// List all accounts
    AllAccounts {
        start_after: Option<String>,
        limit: Option<u32>,
    },
}

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let minter = deps.api.addr_validate(&msg.minter)?;
    
    let token_info = TokenInfo {
        name: msg.name.clone(),
        symbol: msg.symbol.clone(),
        decimals: msg.decimals,
        total_supply: msg.initial_supply,
        mint: Some(MinterData {
            minter: minter.clone(),
            cap: msg.cap,
        }),
    };
    
    TOKEN_INFO.save(deps.storage, &token_info)?;
    
    // Set initial supply to minter
    if !msg.initial_supply.is_zero() {
        BALANCES.save(deps.storage, &minter, &msg.initial_supply)?;
    }
    
    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("name", msg.name)
        .add_attribute("symbol", msg.symbol)
        .add_attribute("decimals", msg.decimals.to_string())
        .add_attribute("total_supply", msg.initial_supply))
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Transfer { recipient, amount } => execute_transfer(deps, env, info, recipient, amount),
        ExecuteMsg::Burn { amount } => execute_burn(deps, env, info, amount),
        ExecuteMsg::Mint { recipient, amount } => execute_mint(deps, env, info, recipient, amount),
        ExecuteMsg::IncreaseAllowance { spender, amount, expires } => {
            execute_increase_allowance(deps, env, info, spender, amount, expires)
        }
        ExecuteMsg::DecreaseAllowance { spender, amount, expires } => {
            execute_decrease_allowance(deps, env, info, spender, amount, expires)
        }
        ExecuteMsg::TransferFrom { owner, recipient, amount } => {
            execute_transfer_from(deps, env, info, owner, recipient, amount)
        }
        ExecuteMsg::BurnFrom { owner, amount } => execute_burn_from(deps, env, info, owner, amount),
        ExecuteMsg::Send { contract, amount, msg } => execute_send(deps, env, info, contract, amount, msg),
        ExecuteMsg::UpdateMinter { new_minter } => execute_update_minter(deps, info, new_minter),
    }
}

/// SECURITY: Self-transfer guard prevents no-op transactions that waste gas
/// and can be used to emit misleading events.
fn execute_transfer(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    if amount.is_zero() {
        return Err(ContractError::InvalidZeroAmount {});
    }

    let recipient = deps.api.addr_validate(&recipient)?;

    // SECURITY: Prevent self-transfer (no-op that wastes gas and emits misleading events)
    if recipient == info.sender {
        return Err(ContractError::CannotTransferToSelf {});
    }

    BALANCES.update(deps.storage, &info.sender, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default().checked_sub(amount)?)
    })?;

    BALANCES.update(deps.storage, &recipient, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default() + amount)
    })?;

    // MONITORING: Emit structured transfer event for indexers
    let transfer_event = Event::new("cw20_transfer")
        .add_attribute("from", info.sender.as_str())
        .add_attribute("to", recipient.as_str())
        .add_attribute("amount", amount.to_string());

    Ok(Response::new()
        .add_event(transfer_event)
        .add_attribute("action", "transfer")
        .add_attribute("from", info.sender)
        .add_attribute("to", recipient)
        .add_attribute("amount", amount))
}

fn execute_burn(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    if amount.is_zero() {
        return Err(ContractError::InvalidZeroAmount {});
    }
    
    BALANCES.update(deps.storage, &info.sender, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default().checked_sub(amount)?)
    })?;
    
    TOKEN_INFO.update(deps.storage, |mut info| -> StdResult<_> {
        info.total_supply = info.total_supply.checked_sub(amount)?;
        Ok(info)
    })?;
    
    Ok(Response::new()
        .add_attribute("action", "burn")
        .add_attribute("from", info.sender)
        .add_attribute("amount", amount))
}

fn execute_mint(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    if amount.is_zero() {
        return Err(ContractError::InvalidZeroAmount {});
    }
    
    let mut config = TOKEN_INFO.load(deps.storage)?;

    // HIGH-5 FIX: Replace unwrap() with proper error handling
    let mint_data = config.mint.as_ref().ok_or(ContractError::Unauthorized {})?;
    if mint_data.minter != info.sender {
        return Err(ContractError::Unauthorized {});
    }

    // Check cap
    if let Some(cap) = mint_data.cap {
        if config.total_supply + amount > cap {
            return Err(ContractError::CannotExceedCap {});
        }
    }
    
    let recipient = deps.api.addr_validate(&recipient)?;
    
    config.total_supply += amount;
    TOKEN_INFO.save(deps.storage, &config)?;

    BALANCES.update(deps.storage, &recipient, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default() + amount)
    })?;

    // MONITORING: Mint event for supply tracking
    let mint_event = Event::new("cw20_mint")
        .add_attribute("minter", info.sender.as_str())
        .add_attribute("recipient", recipient.as_str())
        .add_attribute("amount", amount.to_string())
        .add_attribute("new_total_supply", config.total_supply.to_string());

    Ok(Response::new()
        .add_event(mint_event)
        .add_attribute("action", "mint")
        .add_attribute("to", recipient)
        .add_attribute("amount", amount))
}

fn execute_increase_allowance(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    spender: String,
    amount: Uint128,
    expires: Option<Expiration>,
) -> Result<Response, ContractError> {
    let spender = deps.api.addr_validate(&spender)?;

    // SECURITY: Cannot set allowance to own account
    if spender == info.sender {
        return Err(ContractError::CannotSetOwnAccount {});
    }

    ALLOWANCES.update(deps.storage, (&info.sender, &spender), |allow| -> StdResult<_> {
        let mut allow = allow.unwrap_or_default();
        if let Some(exp) = expires {
            allow.expires = exp;
        }
        allow.allowance += amount;
        Ok(allow)
    })?;
    
    Ok(Response::new()
        .add_attribute("action", "increase_allowance")
        .add_attribute("owner", info.sender)
        .add_attribute("spender", spender)
        .add_attribute("amount", amount))
}

fn execute_decrease_allowance(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    spender: String,
    amount: Uint128,
    expires: Option<Expiration>,
) -> Result<Response, ContractError> {
    let spender = deps.api.addr_validate(&spender)?;

    // SECURITY: Cannot set allowance to own account
    if spender == info.sender {
        return Err(ContractError::CannotSetOwnAccount {});
    }

    ALLOWANCES.update(deps.storage, (&info.sender, &spender), |allow| -> StdResult<_> {
        let mut allow = allow.unwrap_or_default();
        if let Some(exp) = expires {
            allow.expires = exp;
        }
        allow.allowance = allow.allowance.saturating_sub(amount);
        Ok(allow)
    })?;
    
    Ok(Response::new()
        .add_attribute("action", "decrease_allowance")
        .add_attribute("owner", info.sender)
        .add_attribute("spender", spender)
        .add_attribute("amount", amount))
}

/// SECURITY: Self-transfer guard on delegated transfers
fn execute_transfer_from(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    owner: String,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    if amount.is_zero() {
        return Err(ContractError::InvalidZeroAmount {});
    }

    let owner = deps.api.addr_validate(&owner)?;
    let recipient = deps.api.addr_validate(&recipient)?;

    // SECURITY: Prevent self-transfer via allowance
    if owner == recipient {
        return Err(ContractError::CannotTransferToSelf {});
    }

    // Deduct allowance
    ALLOWANCES.update(deps.storage, (&owner, &info.sender), |allow| -> StdResult<_> {
        let mut allow = allow.ok_or_else(|| StdError::generic_err("No allowance for this spender"))?;
        if allow.expires.is_expired(&env.block) {
            return Err(StdError::generic_err("Allowance expired"));
        }
        allow.allowance = allow.allowance.checked_sub(amount)?;
        Ok(allow)
    })?;

    BALANCES.update(deps.storage, &owner, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default().checked_sub(amount)?)
    })?;

    BALANCES.update(deps.storage, &recipient, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default() + amount)
    })?;

    Ok(Response::new()
        .add_attribute("action", "transfer_from")
        .add_attribute("from", owner)
        .add_attribute("to", recipient)
        .add_attribute("by", info.sender)
        .add_attribute("amount", amount))
}

fn execute_burn_from(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    owner: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    if amount.is_zero() {
        return Err(ContractError::InvalidZeroAmount {});
    }

    let owner = deps.api.addr_validate(&owner)?;

    // Deduct allowance
    ALLOWANCES.update(deps.storage, (&owner, &info.sender), |allow| -> StdResult<_> {
        let mut allow = allow.ok_or_else(|| StdError::generic_err("No allowance for this spender"))?;
        if allow.expires.is_expired(&env.block) {
            return Err(StdError::generic_err("Allowance expired"));
        }
        allow.allowance = allow.allowance.checked_sub(amount)?;
        Ok(allow)
    })?;
    
    BALANCES.update(deps.storage, &owner, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default().checked_sub(amount)?)
    })?;
    
    TOKEN_INFO.update(deps.storage, |mut info| -> StdResult<_> {
        info.total_supply = info.total_supply.checked_sub(amount)?;
        Ok(info)
    })?;
    
    Ok(Response::new()
        .add_attribute("action", "burn_from")
        .add_attribute("from", owner)
        .add_attribute("by", info.sender)
        .add_attribute("amount", amount))
}

/// SECURITY: Self-send guard prevents circular token movement
fn execute_send(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    contract: String,
    amount: Uint128,
    msg: Binary,
) -> Result<Response, ContractError> {
    if amount.is_zero() {
        return Err(ContractError::InvalidZeroAmount {});
    }

    let recipient = deps.api.addr_validate(&contract)?;

    // SECURITY: Prevent sending to self
    if recipient == info.sender {
        return Err(ContractError::CannotTransferToSelf {});
    }

    // Transfer
    BALANCES.update(deps.storage, &info.sender, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default().checked_sub(amount)?)
    })?;
    
    BALANCES.update(deps.storage, &recipient, |balance| -> StdResult<_> {
        Ok(balance.unwrap_or_default() + amount)
    })?;
    
    // Send message to contract
    let send_msg = WasmMsg::Execute {
        contract_addr: contract.clone(),
        msg: to_json_binary(&ReceiveMsg::Receive {
            sender: info.sender.to_string(),
            amount,
            msg,
        })?,
        funds: vec![],
    };
    
    Ok(Response::new()
        .add_message(send_msg)
        .add_attribute("action", "send")
        .add_attribute("from", info.sender)
        .add_attribute("to", contract)
        .add_attribute("amount", amount))
}

/// HIGH-5 FIX: Replace all unwrap() calls with proper error propagation
fn execute_update_minter(
    deps: DepsMut,
    info: MessageInfo,
    new_minter: Option<String>,
) -> Result<Response, ContractError> {
    let mut config = TOKEN_INFO.load(deps.storage)?;

    let current_mint = config.mint.as_ref().ok_or(ContractError::Unauthorized {})?;
    if current_mint.minter != info.sender {
        return Err(ContractError::Unauthorized {});
    }

    let existing_cap = current_mint.cap;

    config.mint = match new_minter {
        Some(m) => {
            let validated = deps.api.addr_validate(&m)?;
            Some(MinterData {
                minter: validated,
                cap: existing_cap,
            })
        }
        None => None, // Renounce minting capability
    };

    TOKEN_INFO.save(deps.storage, &config)?;

    Ok(Response::new().add_attribute("action", "update_minter"))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReceiveMsg {
    Receive {
        sender: String,
        amount: Uint128,
        msg: Binary,
    },
}

impl Expiration {
    pub fn is_expired(&self, block: &cosmwasm_std::BlockInfo) -> bool {
        match self {
            Expiration::AtHeight(height) => block.height >= *height,
            Expiration::AtTime(time) => block.time.seconds() >= *time,
            Expiration::Never {} => false,
        }
    }
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::TokenInfo {} => to_json_binary(&query_token_info(deps)?),
        QueryMsg::Balance { address } => {
            let addr = deps.api.addr_validate(&address)?;
            let balance = BALANCES.load(deps.storage, &addr).unwrap_or_default();
            to_json_binary(&BalanceResponse { balance })
        }
        QueryMsg::Allowance { owner, spender } => {
            let owner = deps.api.addr_validate(&owner)?;
            let spender = deps.api.addr_validate(&spender)?;
            let allowance = ALLOWANCES.load(deps.storage, (&owner, &spender)).unwrap_or_default();
            to_json_binary(&AllowanceResponse {
                allowance: allowance.allowance,
                expires: allowance.expires,
            })
        }
        QueryMsg::Minter {} => {
            let info = TOKEN_INFO.load(deps.storage)?;
            to_json_binary(&info.mint)
        }
        QueryMsg::AllAllowances { owner, start_after, limit } => {
            let owner_addr = deps.api.addr_validate(&owner)?;
            let limit = limit.unwrap_or(30).min(100) as usize;
            let start = start_after.as_deref()
                .map(|s| deps.api.addr_validate(s))
                .transpose()?;
            let min = start.as_ref().map(Bound::exclusive);
            let allowances: Vec<AllowanceResponse> = ALLOWANCES
                .prefix(&owner_addr)
                .range(deps.storage, min, None, cosmwasm_std::Order::Ascending)
                .take(limit)
                .filter_map(|r| r.ok().map(|(_spender, info)| {
                    AllowanceResponse {
                        allowance: info.allowance,
                        expires: info.expires,
                    }
                }))
                .collect();
            to_json_binary(&allowances)
        }
        QueryMsg::AllAccounts { start_after, limit } => {
            let limit = limit.unwrap_or(30).min(100) as usize;
            let start = start_after.as_deref()
                .map(|s| deps.api.addr_validate(s))
                .transpose()?;
            let min = start.as_ref().map(Bound::exclusive);
            let accounts: Vec<String> = BALANCES
                .range(deps.storage, min, None, cosmwasm_std::Order::Ascending)
                .take(limit)
                .filter_map(|r| r.ok().map(|(addr, _)| addr.to_string()))
                .collect();
            to_json_binary(&accounts)
        }
    }
}

fn query_token_info(deps: Deps) -> StdResult<TokenInfoResponse> {
    let info = TOKEN_INFO.load(deps.storage)?;
    Ok(TokenInfoResponse {
        name: info.name,
        symbol: info.symbol,
        decimals: info.decimals,
        total_supply: info.total_supply,
    })
}

// L-04 FIX: Migration entry point for on-chain contract upgrades.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> StdResult<Response> {
    let version = cw2::get_contract_version(deps.storage)?;
    if version.contract != CONTRACT_NAME {
        return Err(StdError::generic_err("Cannot migrate from a different contract"));
    }
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new()
        .add_attribute("action", "migrate")
        .add_attribute("from_version", version.version)
        .add_attribute("to_version", CONTRACT_VERSION))
}

#[cfg(test)]
mod contract_tests;

