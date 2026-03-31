/**
 * Seal Manager Contract
 *
 * Manages digital seals (verifiable attestations) for AI job outputs.
 */
use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo, Response,
    StdResult, Timestamp,
};
use cw2::set_contract_version;
use cw_storage_plus::{Index, IndexList, IndexedMap, Item, Map, MultiIndex};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const CONTRACT_NAME: &str = "crates.io:seal-manager";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),
    #[error("Unauthorized")]
    Unauthorized {},
    #[error("Seal not found")]
    SealNotFound {},
    #[error("Invalid seal status")]
    InvalidSealStatus {},
    #[error("Seal expired")]
    SealExpired {},
    #[error("Seal already revoked")]
    AlreadyRevoked {},
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    /// SECURITY: AI Job Manager contract address for cross-contract job verification
    pub ai_job_manager: Addr,
    pub min_validators: u32,
    pub max_validators: u32,
    pub default_expiration: u64,
    pub max_expiration: u64,
}

/// Cross-contract query message for the AI Job Manager
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AiJobManagerQueryMsg {
    Job { job_id: String },
}

/// Minimal job response for cross-contract verification
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct JobResponse {
    pub id: String,
    pub status: JobStatusResponse,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobStatusResponse {
    Pending,
    Assigned,
    Computing,
    Completed,
    Verified,
    Failed,
    Expired,
    Cancelled,
    Paid,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Seal {
    pub id: String,
    pub job_id: String,
    pub status: SealStatus,
    pub requester: Addr,
    pub validators: Vec<Addr>,
    pub model_commitment: String,
    pub input_commitment: String,
    pub output_commitment: String,
    pub created_at: Timestamp,
    pub expires_at: Option<Timestamp>,
    pub revoked_at: Option<Timestamp>,
    pub revoked_by: Option<Addr>,
    pub revocation_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SealStatus {
    Active,
    Revoked,
    Expired,
    Superseded,
}

pub struct SealIndexes<'a> {
    pub job_id: MultiIndex<'a, String, Seal, String>,
    pub requester: MultiIndex<'a, Addr, Seal, String>,
    pub status: MultiIndex<'a, String, Seal, String>,
}

impl<'a> IndexList<Seal> for SealIndexes<'a> {
    fn get_indexes(&'_ self) -> Box<dyn Iterator<Item = &'_ dyn Index<Seal>> + '_> {
        let v: Vec<&dyn Index<Seal>> = vec![&self.job_id, &self.requester, &self.status];
        Box::new(v.into_iter())
    }
}

const CONFIG: Item<Config> = Item::new("config");
const SEAL_COUNT: Item<u64> = Item::new("seal_count");

fn seals<'a>() -> IndexedMap<'a, String, Seal, SealIndexes<'a>> {
    let indexes = SealIndexes {
        job_id: MultiIndex::new(
            |_pk: &[u8], d: &Seal| d.job_id.clone(),
            "seals",
            "seals__job_id",
        ),
        requester: MultiIndex::new(
            |_pk: &[u8], d: &Seal| d.requester.clone(),
            "seals",
            "seals__requester",
        ),
        status: MultiIndex::new(
            |_pk: &[u8], d: &Seal| format!("{:?}", d.status),
            "seals",
            "seals__status",
        ),
    };
    IndexedMap::new("seals", indexes)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub ai_job_manager: String,
    pub min_validators: u32,
    pub max_validators: u32,
    pub default_expiration: u64,
    pub max_expiration: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    CreateSeal {
        job_id: String,
        model_commitment: String,
        input_commitment: String,
        output_commitment: String,
        validator_addresses: Vec<String>,
        expiration: Option<u64>,
    },
    RevokeSeal {
        seal_id: String,
        reason: String,
    },
    VerifySeal {
        seal_id: String,
    },
    ExtendExpiration {
        seal_id: String,
        additional_seconds: u64,
    },
    SupersedeSeal {
        old_seal_id: String,
        job_id: String,
        model_commitment: String,
        input_commitment: String,
        output_commitment: String,
        validator_addresses: Vec<String>,
    },
    BatchVerify {
        seal_ids: Vec<String>,
    },
    UpdateConfig {
        min_validators: Option<u32>,
        max_validators: Option<u32>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Seal {
        seal_id: String,
    },
    ListSeals {
        status: Option<String>,
        requester: Option<String>,
        limit: Option<u32>,
    },
    Verify {
        seal_id: String,
    },
    JobSealHistory {
        job_id: String,
    },
    Stats {},
    IsValid {
        seal_id: String,
    },
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
        admin: info.sender,
        ai_job_manager: deps.api.addr_validate(&msg.ai_job_manager)?,
        min_validators: msg.min_validators,
        max_validators: msg.max_validators,
        default_expiration: msg.default_expiration,
        max_expiration: msg.max_expiration,
    };

    CONFIG.save(deps.storage, &config)?;
    SEAL_COUNT.save(deps.storage, &0)?;

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
        ExecuteMsg::CreateSeal {
            job_id,
            model_commitment,
            input_commitment,
            output_commitment,
            validator_addresses,
            expiration,
        } => execute_create_seal(
            deps,
            env,
            info,
            job_id,
            model_commitment,
            input_commitment,
            output_commitment,
            validator_addresses,
            expiration,
        ),
        ExecuteMsg::RevokeSeal { seal_id, reason } => {
            execute_revoke_seal(deps, env, info, seal_id, reason)
        }
        ExecuteMsg::VerifySeal { seal_id } => execute_verify_seal(deps, env, seal_id),
        ExecuteMsg::ExtendExpiration {
            seal_id,
            additional_seconds,
        } => execute_extend_expiration(deps, env, info, seal_id, additional_seconds),
        ExecuteMsg::SupersedeSeal {
            old_seal_id,
            job_id,
            model_commitment,
            input_commitment,
            output_commitment,
            validator_addresses,
        } => execute_supersede_seal(
            deps,
            env,
            info,
            old_seal_id,
            job_id,
            model_commitment,
            input_commitment,
            output_commitment,
            validator_addresses,
        ),
        ExecuteMsg::BatchVerify { seal_ids } => execute_batch_verify(deps, env, seal_ids),
        ExecuteMsg::UpdateConfig {
            min_validators,
            max_validators,
        } => execute_update_config(deps, info, min_validators, max_validators),
    }
}

fn execute_create_seal(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    job_id: String,
    model_commitment: String,
    input_commitment: String,
    output_commitment: String,
    validator_addresses: Vec<String>,
    expiration: Option<u64>,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // SECURITY: Cross-contract query to verify job exists and is in a valid terminal state.
    // Prevents seals from being created for non-existent or in-progress jobs.
    let job_response: JobResponse = deps
        .querier
        .query_wasm_smart(
            config.ai_job_manager.to_string(),
            &AiJobManagerQueryMsg::Job {
                job_id: job_id.clone(),
            },
        )
        .map_err(|_| {
            ContractError::Std(cosmwasm_std::StdError::generic_err(format!(
                "Job '{}' not found in AI Job Manager",
                job_id
            )))
        })?;

    // Only allow seals for verified or paid (completed+paid) jobs
    match job_response.status {
        JobStatusResponse::Verified | JobStatusResponse::Paid | JobStatusResponse::Completed => {}
        _ => {
            return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
                format!(
                    "Job '{}' is not in a valid state for sealing (status: {:?})",
                    job_id, job_response.status
                ),
            )));
        }
    }

    let validator_count = validator_addresses.len() as u32;
    if validator_count < config.min_validators || validator_count > config.max_validators {
        return Err(ContractError::InvalidSealStatus {});
    }

    let validators: Result<Vec<Addr>, _> = validator_addresses
        .into_iter()
        .map(|v| deps.api.addr_validate(&v))
        .collect();
    let validators = validators?;

    let expires_at =
        expiration.map(|exp| env.block.time.plus_seconds(exp.min(config.max_expiration)));

    let count = SEAL_COUNT.load(deps.storage)?;
    let seal_id = generate_seal_id(&job_id, &info.sender, count);

    let seal = Seal {
        id: seal_id.clone(),
        job_id: job_id.clone(),
        status: SealStatus::Active,
        requester: info.sender.clone(),
        validators,
        model_commitment,
        input_commitment,
        output_commitment,
        created_at: env.block.time,
        expires_at,
        revoked_at: None,
        revoked_by: None,
        revocation_reason: None,
    };

    seals().save(deps.storage, seal_id.clone(), &seal)?;
    SEAL_COUNT.save(deps.storage, &(count + 1))?;

    Ok(Response::new()
        .add_attribute("action", "create_seal")
        .add_attribute("seal_id", seal_id)
        .add_attribute("job_id", job_id))
}

fn execute_revoke_seal(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    seal_id: String,
    reason: String,
) -> Result<Response, ContractError> {
    let mut seal = seals().load(deps.storage, seal_id.clone())?;

    if seal.requester != info.sender {
        return Err(ContractError::Unauthorized {});
    }

    if seal.status != SealStatus::Active {
        return Err(ContractError::InvalidSealStatus {});
    }

    seal.status = SealStatus::Revoked;
    seal.revoked_at = Some(env.block.time);
    seal.revoked_by = Some(info.sender.clone());
    seal.revocation_reason = Some(reason.clone());

    seals().save(deps.storage, seal_id.clone(), &seal)?;

    Ok(Response::new()
        .add_attribute("action", "revoke_seal")
        .add_attribute("seal_id", seal_id)
        .add_attribute("reason", reason))
}

fn execute_extend_expiration(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    seal_id: String,
    additional_seconds: u64,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut seal = seals().load(deps.storage, seal_id.clone())?;

    if seal.requester != info.sender {
        return Err(ContractError::Unauthorized {});
    }

    if seal.status != SealStatus::Active {
        return Err(ContractError::InvalidSealStatus {});
    }

    let current_expiry = seal.expires_at.unwrap_or(env.block.time);
    let max_expiry = env.block.time.plus_seconds(config.max_expiration);

    let new_expiry = current_expiry.plus_seconds(additional_seconds);
    if new_expiry > max_expiry {
        return Err(ContractError::InvalidSealStatus {});
    }

    seal.expires_at = Some(new_expiry);
    seals().save(deps.storage, seal_id.clone(), &seal)?;

    Ok(Response::new()
        .add_attribute("action", "extend_expiration")
        .add_attribute("seal_id", seal_id))
}

fn execute_supersede_seal(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    old_seal_id: String,
    job_id: String,
    model_commitment: String,
    input_commitment: String,
    output_commitment: String,
    validator_addresses: Vec<String>,
) -> Result<Response, ContractError> {
    let mut old_seal = seals().load(deps.storage, old_seal_id.clone())?;

    if old_seal.requester != info.sender {
        return Err(ContractError::Unauthorized {});
    }

    let config = CONFIG.load(deps.storage)?;

    // M-08 FIX: Validate validator count before superseding
    let validator_count = validator_addresses.len() as u32;
    if validator_count < config.min_validators || validator_count > config.max_validators {
        return Err(ContractError::InvalidSealStatus {});
    }

    old_seal.status = SealStatus::Superseded;
    seals().save(deps.storage, old_seal_id.clone(), &old_seal)?;

    let validators: Result<Vec<Addr>, _> = validator_addresses
        .into_iter()
        .map(|v| deps.api.addr_validate(&v))
        .collect();
    let validators = validators?;
    let count = SEAL_COUNT.load(deps.storage)?;
    let new_seal_id = generate_seal_id(&job_id, &info.sender, count);

    let new_seal = Seal {
        id: new_seal_id.clone(),
        job_id: job_id.clone(),
        status: SealStatus::Active,
        requester: info.sender.clone(),
        validators,
        model_commitment,
        input_commitment,
        output_commitment,
        created_at: env.block.time,
        expires_at: Some(env.block.time.plus_seconds(config.default_expiration)),
        revoked_at: None,
        revoked_by: None,
        revocation_reason: None,
    };

    seals().save(deps.storage, new_seal_id.clone(), &new_seal)?;
    SEAL_COUNT.save(deps.storage, &(count + 1))?;

    Ok(Response::new()
        .add_attribute("action", "supersede_seal")
        .add_attribute("old_seal_id", old_seal_id)
        .add_attribute("new_seal_id", new_seal_id))
}

/// C-02 FIX: Real seal verification — checks existence, active status, and expiry.
/// Emits per-seal events so callers and indexers can track results.
fn execute_verify_seal(
    deps: DepsMut,
    env: Env,
    seal_id: String,
) -> Result<Response, ContractError> {
    let seal = seals()
        .load(deps.storage, seal_id.clone())
        .map_err(|_| ContractError::SealNotFound {})?;

    let (valid, status) = check_seal_validity(&seal, &env);

    Ok(Response::new()
        .add_attribute("action", "verify_seal")
        .add_attribute("seal_id", seal_id)
        .add_attribute("valid", valid.to_string())
        .add_attribute("status", &status)
        .add_attribute("validators", seal.validators.len().to_string()))
}

/// C-02 FIX: Real batch verification — each seal is individually checked.
/// Returns per-seal results via events and aggregates in attributes.
fn execute_batch_verify(
    deps: DepsMut,
    env: Env,
    seal_ids: Vec<String>,
) -> Result<Response, ContractError> {
    let mut verified = 0u64;
    let mut failed = 0u64;
    let mut response = Response::new();

    for seal_id in &seal_ids {
        match seals().load(deps.storage, seal_id.clone()) {
            Ok(seal) => {
                let (valid, status) = check_seal_validity(&seal, &env);
                if valid {
                    verified += 1;
                } else {
                    failed += 1;
                }
                response = response.add_event(
                    cosmwasm_std::Event::new("seal_verified")
                        .add_attribute("seal_id", seal_id)
                        .add_attribute("valid", valid.to_string())
                        .add_attribute("status", status),
                );
            }
            Err(_) => {
                failed += 1;
                response = response.add_event(
                    cosmwasm_std::Event::new("seal_verified")
                        .add_attribute("seal_id", seal_id)
                        .add_attribute("valid", "false")
                        .add_attribute("status", "not_found"),
                );
            }
        }
    }

    Ok(response
        .add_attribute("action", "batch_verify")
        .add_attribute("total", seal_ids.len().to_string())
        .add_attribute("verified", verified.to_string())
        .add_attribute("failed", failed.to_string()))
}

/// Shared helper: determine if a seal is valid (active and not expired).
fn check_seal_validity(seal: &Seal, env: &Env) -> (bool, String) {
    match seal.status {
        SealStatus::Active => {
            if let Some(expires) = seal.expires_at {
                if env.block.time > expires {
                    (false, "expired".to_string())
                } else {
                    (true, "active".to_string())
                }
            } else {
                (true, "active".to_string())
            }
        }
        SealStatus::Revoked => (false, "revoked".to_string()),
        SealStatus::Expired => (false, "expired".to_string()),
        SealStatus::Superseded => (false, "superseded".to_string()),
    }
}

fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    min_validators: Option<u32>,
    max_validators: Option<u32>,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    if let Some(min) = min_validators {
        config.min_validators = min;
    }
    if let Some(max) = max_validators {
        config.max_validators = max;
    }

    CONFIG.save(deps.storage, &config)?;
    Ok(Response::new().add_attribute("action", "update_config"))
}

#[entry_point]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Seal { seal_id } => {
            let seal = seals().load(deps.storage, seal_id)?;
            to_json_binary(&seal)
        }
        QueryMsg::ListSeals {
            status,
            requester,
            limit,
        } => to_json_binary(&query_list_seals(deps, status, requester, limit)?),
        QueryMsg::Verify { seal_id } => to_json_binary(&query_verify(deps, env, seal_id)?),
        QueryMsg::JobSealHistory { job_id } => {
            let seals_list: Vec<Seal> = seals()
                .idx
                .job_id
                .prefix(job_id)
                .range(deps.storage, None, None, cosmwasm_std::Order::Ascending)
                .filter_map(|r| r.ok().map(|(_, s)| s))
                .collect();
            to_json_binary(&seals_list)
        }
        QueryMsg::Stats {} => {
            let total = SEAL_COUNT.load(deps.storage)?;
            to_json_binary(&SealStats { total_seals: total })
        }
        QueryMsg::IsValid { seal_id } => {
            let verify_res = query_verify(deps, env, seal_id)?;
            to_json_binary(&verify_res.valid)
        }
    }
}

fn query_list_seals(
    deps: Deps,
    status: Option<String>,
    requester: Option<String>,
    limit: Option<u32>,
) -> StdResult<Vec<Seal>> {
    let limit = limit.unwrap_or(50) as usize;
    let requester_addr = requester.map(|r| Addr::unchecked(r));
    let seals_list: Vec<Seal> = seals()
        .range(deps.storage, None, None, cosmwasm_std::Order::Descending)
        .filter_map(|r| r.ok().map(|(_, seal)| seal))
        .filter(|seal| {
            if let Some(ref req) = requester_addr {
                if &seal.requester != req {
                    return false;
                }
            }
            if let Some(ref s) = status {
                let seal_status = format!("{:?}", seal.status).to_lowercase();
                if &seal_status != s {
                    return false;
                }
            }
            true
        })
        .take(limit)
        .collect();
    Ok(seals_list)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct VerifyResponse {
    pub valid: bool,
    pub status: String,
}

fn query_verify(deps: Deps, env: Env, seal_id: String) -> StdResult<VerifyResponse> {
    let seal = seals().load(deps.storage, seal_id)?;
    let (valid, status) = check_seal_validity(&seal, &env);
    Ok(VerifyResponse { valid, status })
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SealStats {
    pub total_seals: u64,
}

fn generate_seal_id(job_id: &str, requester: &Addr, nonce: u64) -> String {
    let data = format!("{}:{}:{}", job_id, requester, nonce);
    let hash = Sha256::digest(data.as_bytes());
    format!("seal_{}", hex::encode(&hash[..16]))
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

#[cfg(test)]
mod contract_tests;
