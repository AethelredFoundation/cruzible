/**
 * Model Registry Contract
 * 
 * Manages registration and verification of AI models for the Aethelred network.
 * Models are registered with their hash, architecture, and metadata.
 */

use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
    Addr, Timestamp, Uint128, Event,
};
use cw2::set_contract_version;
use cw_storage_plus::{Item, Map, IndexedMap, Index, IndexList, MultiIndex};
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use thiserror::Error;

const CONTRACT_NAME: &str = "crates.io:model-registry";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),
    #[error("Unauthorized")]
    Unauthorized {},
    #[error("Model not found")]
    ModelNotFound {},
    #[error("Model already exists")]
    ModelExists {},
    #[error("Invalid category")]
    InvalidCategory {},
    #[error("Not verified")]
    NotVerified {},
    #[error("Rate limited: try again later")]
    RateLimited {},
}

// ============ SECURITY CONSTANTS ============

/// Maximum models per owner (DoS protection)
const MAX_MODELS_PER_OWNER: u64 = 500;
/// Rate limit: minimum blocks between registrations per address
const REGISTRATION_COOLDOWN_BLOCKS: u64 = 5;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    /// SECURITY: Only this contract address (AI Job Manager) can call IncrementJobCount
    pub ai_job_manager: Option<Addr>,
    pub registration_fee: Uint128,
    pub verification_required: bool,
    pub verifiers: Vec<Addr>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Model {
    pub model_hash: String,
    pub name: String,
    pub owner: Addr,
    pub architecture: String,
    pub version: String,
    pub category: ModelCategory,
    pub input_schema: String,
    pub output_schema: String,
    pub storage_uri: String,
    pub size_bytes: Option<u64>,
    pub verified: bool,
    pub verified_by: Option<Addr>,
    pub total_jobs: u64,
    pub registered_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModelCategory {
    General,
    Medical,
    Scientific,
    Financial,
    Legal,
    Educational,
    Environmental,
}

pub struct ModelIndexes<'a> {
    pub owner: MultiIndex<'a, Addr, Model, String>,
    pub category: MultiIndex<'a, String, Model, String>,
    pub verified: MultiIndex<'a, String, Model, String>,
}

impl<'a> IndexList<Model> for ModelIndexes<'a> {
    fn get_indexes(&'_ self) -> Box<dyn Iterator<Item = &'_ dyn Index<Model>> + '_> {
        let v: Vec<&dyn Index<Model>> = vec![&self.owner, &self.category, &self.verified];
        Box::new(v.into_iter())
    }
}

const CONFIG: Item<Config> = Item::new("config");
const MODEL_COUNT: Item<u64> = Item::new("model_count");
/// Rate limiting: last registration block per address
const LAST_REGISTRATION: Map<&Addr, u64> = Map::new("last_registration");
/// Per-owner model count for DoS protection
const OWNER_MODEL_COUNT: Map<&Addr, u64> = Map::new("owner_model_count");

fn models<'a>() -> IndexedMap<'a, String, Model, ModelIndexes<'a>> {
    let indexes = ModelIndexes {
        owner: MultiIndex::new(|_pk: &[u8], d: &Model| d.owner.clone(), "models", "models__owner"),
        category: MultiIndex::new(|_pk: &[u8], d: &Model| format!("{:?}", d.category), "models", "models__category"),
        verified: MultiIndex::new(|_pk: &[u8], d: &Model| if d.verified { "true".to_string() } else { "false".to_string() }, "models", "models__verified"),
    };
    IndexedMap::new("models", indexes)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub registration_fee: Uint128,
    pub verification_required: bool,
    pub verifiers: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    RegisterModel {
        name: String,
        model_hash: String,
        architecture: String,
        version: String,
        category: ModelCategory,
        input_schema: String,
        output_schema: String,
        storage_uri: String,
        size_bytes: Option<u64>,
    },
    UpdateModel {
        model_hash: String,
        name: Option<String>,
        storage_uri: Option<String>,
    },
    DeregisterModel { model_hash: String },
    VerifyModel { model_hash: String },
    IncrementJobCount { model_hash: String },
    UpdateConfig {
        registration_fee: Option<Uint128>,
        ai_job_manager: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},
    Model { model_hash: String },
    ListModels {
        category: Option<String>,
        owner: Option<String>,
        verified: Option<bool>,
        limit: Option<u32>,
    },
    ModelsByOwner { owner: String },
    Stats {},
}

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    
    let verifiers: Result<Vec<Addr>, _> = msg.verifiers.iter().map(|v| deps.api.addr_validate(v)).collect();
    
    let config = Config {
        admin: info.sender,
        ai_job_manager: None, // Set via UpdateConfig after AI Job Manager is deployed
        registration_fee: msg.registration_fee,
        verification_required: msg.verification_required,
        verifiers: verifiers?,
    };
    
    CONFIG.save(deps.storage, &config)?;
    MODEL_COUNT.save(deps.storage, &0)?;
    
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
        ExecuteMsg::RegisterModel { name, model_hash, architecture, version, category, input_schema, output_schema, storage_uri, size_bytes } => {
            execute_register_model(deps, env, info, name, model_hash, architecture, version, category, input_schema, output_schema, storage_uri, size_bytes)
        }
        ExecuteMsg::UpdateModel { model_hash, name, storage_uri } => {
            execute_update_model(deps, env, info, model_hash, name, storage_uri)
        }
        ExecuteMsg::DeregisterModel { model_hash } => execute_deregister_model(deps, info, model_hash),
        ExecuteMsg::VerifyModel { model_hash } => execute_verify_model(deps, info, model_hash),
        ExecuteMsg::IncrementJobCount { model_hash } => execute_increment_job_count(deps, info, model_hash),
        ExecuteMsg::UpdateConfig { registration_fee, ai_job_manager } => {
            execute_update_config(deps, info, registration_fee, ai_job_manager)
        }
    }
}

fn execute_register_model(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    name: String,
    model_hash: String,
    architecture: String,
    version: String,
    category: ModelCategory,
    input_schema: String,
    output_schema: String,
    storage_uri: String,
    size_bytes: Option<u64>,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // RATE LIMITING: Prevent spam registrations
    let last_block = LAST_REGISTRATION.may_load(deps.storage, &info.sender)?.unwrap_or(0);
    if env.block.height < last_block + REGISTRATION_COOLDOWN_BLOCKS {
        return Err(ContractError::RateLimited {});
    }

    // DoS PROTECTION: Limit models per owner
    let owner_count = OWNER_MODEL_COUNT.may_load(deps.storage, &info.sender)?.unwrap_or(0);
    if owner_count >= MAX_MODELS_PER_OWNER {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            format!("Maximum models per owner ({}) exceeded", MAX_MODELS_PER_OWNER)
        )));
    }

    // MED-6: Input validation — prevent empty/oversized strings
    if name.is_empty() || name.len() > 256 {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            "Name must be 1-256 characters"
        )));
    }
    if model_hash.is_empty() || model_hash.len() > 128 {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            "Model hash must be 1-128 characters"
        )));
    }
    if architecture.is_empty() || architecture.len() > 256 {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            "Architecture must be 1-256 characters"
        )));
    }
    if version.is_empty() || version.len() > 64 {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            "Version must be 1-64 characters"
        )));
    }
    if storage_uri.is_empty() || storage_uri.len() > 2048 {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            "Storage URI must be 1-2048 characters"
        )));
    }
    if input_schema.len() > 10240 || output_schema.len() > 10240 {
        return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            "Schema must be at most 10240 characters"
        )));
    }

    // MED-3: Enforce registration fee payment
    if !config.registration_fee.is_zero() {
        let paid = info
            .funds
            .iter()
            .find(|c| c.denom == "uaeth")
            .map(|c| c.amount)
            .unwrap_or_default();
        if paid < config.registration_fee {
            return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
                format!("Insufficient registration fee: required {}, got {}", config.registration_fee, paid)
            )));
        }
    }

    // Check if model already exists
    if models().may_load(deps.storage, model_hash.clone())?.is_some() {
        return Err(ContractError::ModelExists {});
    }
    
    let model = Model {
        model_hash: model_hash.clone(),
        name,
        owner: info.sender.clone(),
        architecture,
        version,
        category: category.clone(),
        input_schema,
        output_schema,
        storage_uri,
        size_bytes,
        verified: !config.verification_required,
        verified_by: if config.verification_required { None } else { Some(info.sender.clone()) },
        total_jobs: 0,
        registered_at: env.block.time,
        updated_at: env.block.time,
    };
    
    models().save(deps.storage, model_hash.clone(), &model)?;

    let count = MODEL_COUNT.load(deps.storage)?;
    MODEL_COUNT.save(deps.storage, &(count + 1))?;

    // Update rate limiting and owner count
    LAST_REGISTRATION.save(deps.storage, &info.sender, &env.block.height)?;
    OWNER_MODEL_COUNT.save(deps.storage, &info.sender, &(owner_count + 1))?;

    // MONITORING: Emit structured event for indexers
    let register_event = Event::new("model_registered")
        .add_attribute("model_hash", &model_hash)
        .add_attribute("owner", info.sender.as_str())
        .add_attribute("category", format!("{:?}", category))
        .add_attribute("verified", (!config.verification_required).to_string())
        .add_attribute("total_models", (count + 1).to_string());

    Ok(Response::new()
        .add_event(register_event)
        .add_attribute("action", "register_model")
        .add_attribute("model_hash", model_hash)
        .add_attribute("owner", info.sender))
}

fn execute_update_model(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    model_hash: String,
    name: Option<String>,
    storage_uri: Option<String>,
) -> Result<Response, ContractError> {
    let mut model = models().load(deps.storage, model_hash.clone())?;
    
    if model.owner != info.sender {
        return Err(ContractError::Unauthorized {});
    }
    
    if let Some(n) = name {
        model.name = n;
    }
    if let Some(uri) = storage_uri {
        model.storage_uri = uri;
    }
    
    model.updated_at = env.block.time;
    models().save(deps.storage, model_hash.clone(), &model)?;
    
    Ok(Response::new().add_attribute("action", "update_model").add_attribute("model_hash", model_hash))
}

fn execute_deregister_model(
    deps: DepsMut,
    info: MessageInfo,
    model_hash: String,
) -> Result<Response, ContractError> {
    let model = models().load(deps.storage, model_hash.clone())?;
    
    if model.owner != info.sender {
        return Err(ContractError::Unauthorized {});
    }
    
    models().remove(deps.storage, model_hash.clone())?;

    let count = MODEL_COUNT.load(deps.storage)?;
    MODEL_COUNT.save(deps.storage, &(count.saturating_sub(1)))?;

    // Update owner model count
    let owner_count = OWNER_MODEL_COUNT.may_load(deps.storage, &info.sender)?.unwrap_or(0);
    OWNER_MODEL_COUNT.save(deps.storage, &info.sender, &owner_count.saturating_sub(1))?;

    // MONITORING: Emit deregistration event for indexers
    let deregister_event = Event::new("model_deregistered")
        .add_attribute("model_hash", &model_hash)
        .add_attribute("owner", info.sender.as_str())
        .add_attribute("remaining_models", count.saturating_sub(1).to_string());

    Ok(Response::new()
        .add_event(deregister_event)
        .add_attribute("action", "deregister_model")
        .add_attribute("model_hash", model_hash))
}

fn execute_verify_model(
    deps: DepsMut,
    info: MessageInfo,
    model_hash: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut model = models().load(deps.storage, model_hash.clone())?;
    
    if !config.verifiers.contains(&info.sender) && config.admin != info.sender {
        return Err(ContractError::Unauthorized {});
    }
    
    model.verified = true;
    model.verified_by = Some(info.sender.clone());
    models().save(deps.storage, model_hash.clone(), &model)?;

    // MONITORING: Emit verification event for indexers and alerting
    let verify_event = Event::new("model_verified")
        .add_attribute("model_hash", &model_hash)
        .add_attribute("verified_by", info.sender.as_str())
        .add_attribute("model_owner", model.owner.as_str());

    Ok(Response::new()
        .add_event(verify_event)
        .add_attribute("action", "verify_model")
        .add_attribute("model_hash", model_hash))
}

/// SECURITY: Only the AI Job Manager contract or admin can increment job counts.
/// Without this check, anyone could inflate model statistics to manipulate rankings.
fn execute_increment_job_count(
    deps: DepsMut,
    info: MessageInfo,
    model_hash: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // Authorization: only AI Job Manager or admin
    let is_job_manager = config.ai_job_manager.as_ref() == Some(&info.sender);
    let is_admin = config.admin == info.sender;
    if !is_job_manager && !is_admin {
        return Err(ContractError::Unauthorized {});
    }

    let mut model = models().load(deps.storage, model_hash.clone())?;
    model.total_jobs += 1;
    models().save(deps.storage, model_hash.clone(), &model)?;

    Ok(Response::new().add_attribute("action", "increment_job_count").add_attribute("model_hash", model_hash))
}

/// MED-3 fix: enforce a maximum registration fee to prevent admin abuse.
const MAX_REGISTRATION_FEE: u128 = 1_000_000_000_000; // 1M tokens with 6 decimals

fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    registration_fee: Option<Uint128>,
    ai_job_manager: Option<String>,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    if let Some(fee) = registration_fee {
        // MED-3: Enforce maximum fee to prevent admin from setting extortionate fees
        if fee > Uint128::from(MAX_REGISTRATION_FEE) {
            return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
                "Registration fee exceeds maximum allowed"
            )));
        }
        config.registration_fee = fee;
    }

    if let Some(jm) = ai_job_manager {
        config.ai_job_manager = Some(deps.api.addr_validate(&jm)?);
    }

    CONFIG.save(deps.storage, &config)?;

    // MONITORING: Config change events for governance tracking
    let config_event = Event::new("config_updated")
        .add_attribute("updated_by", info.sender.as_str())
        .add_attribute("registration_fee", config.registration_fee.to_string())
        .add_attribute("ai_job_manager", config.ai_job_manager
            .as_ref()
            .map(|a| a.to_string())
            .unwrap_or_else(|| "none".to_string()));

    Ok(Response::new()
        .add_event(config_event)
        .add_attribute("action", "update_config"))
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&CONFIG.load(deps.storage)?),
        QueryMsg::Model { model_hash } => {
            let model = models().load(deps.storage, model_hash)?;
            to_json_binary(&model)
        }
        QueryMsg::ListModels { category, owner, verified, limit } => {
            to_json_binary(&query_list_models(deps, category, owner, verified, limit)?)
        }
        QueryMsg::ModelsByOwner { owner } => {
            let addr = deps.api.addr_validate(&owner)?;
            let models_list: Vec<Model> = models()
                .idx
                .owner
                .prefix(addr)
                .range(deps.storage, None, None, cosmwasm_std::Order::Descending)
                .filter_map(|r| r.ok().map(|(_, m)| m))
                .collect();
            to_json_binary(&models_list)
        }
        QueryMsg::Stats {} => {
            let total = MODEL_COUNT.load(deps.storage)?;
            to_json_binary(&ModelStats { total_models: total })
        }
    }
}

fn query_list_models(
    deps: Deps,
    _category: Option<String>,
    _owner: Option<String>,
    verified: Option<bool>,
    limit: Option<u32>,
) -> StdResult<Vec<Model>> {
    let limit = limit.unwrap_or(50) as usize;
    
    let models_list: Vec<Model> = if let Some(v) = verified {
        let v_str = if v { "true".to_string() } else { "false".to_string() };
        models()
            .idx
            .verified
            .prefix(v_str)
            .range(deps.storage, None, None, cosmwasm_std::Order::Descending)
            .take(limit)
            .filter_map(|r| r.ok().map(|(_, m)| m))
            .collect()
    } else {
        models()
            .range(deps.storage, None, None, cosmwasm_std::Order::Descending)
            .take(limit)
            .filter_map(|r| r.ok().map(|(_, m)| m))
            .collect()
    };
    
    Ok(models_list)
}

/// L-09 FIX: Typed response struct replacing serde_json::json! macro
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ModelStats {
    pub total_models: u64,
}

// L-04 FIX: Migration entry point for on-chain contract upgrades.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

#[entry_point]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> StdResult<Response> {
    let version = cw2::get_contract_version(deps.storage)?;
    if version.contract != CONTRACT_NAME {
        return Err(cosmwasm_std::StdError::generic_err("Cannot migrate from a different contract"));
    }
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new()
        .add_attribute("action", "migrate")
        .add_attribute("from_version", version.version)
        .add_attribute("to_version", CONTRACT_VERSION))
}

#[cfg(test)]
mod contract_tests;

