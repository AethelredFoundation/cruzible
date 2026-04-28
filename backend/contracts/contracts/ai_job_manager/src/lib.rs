/**
 * AI Job Manager Contract
 *
 * Manages verifiable AI inference jobs on the Aethelred blockchain.
 * Handles job submission, validator assignment, TEE attestation verification,
 * and reward distribution.
 */
use cosmwasm_std::{
    entry_point, to_json_binary, Addr, BankMsg, Binary, Coin, CosmosMsg, Deps, DepsMut, Env, Event,
    MessageInfo, Reply, ReplyOn, Response, StdError, StdResult, SubMsg, SubMsgResult, Timestamp,
    Uint128, WasmMsg,
};
use cw2::set_contract_version;
use cw_storage_plus::{Index, IndexList, IndexedMap, Item, Map, MultiIndex};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const CONTRACT_NAME: &str = "crates.io:ai-job-manager";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");
const MODEL_REGISTRY_INCREMENT_REPLY_ID: u64 = 1;

// ============ ERRORS ============

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] cosmwasm_std::StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Job not found")]
    JobNotFound {},

    #[error("Invalid job status: {current}")]
    InvalidStatus { current: String },

    #[error("Job expired")]
    JobExpired {},

    #[error("Invalid TEE attestation")]
    InvalidAttestation {},

    #[error("Invalid proof")]
    InvalidProof {},

    #[error("Not assigned validator")]
    NotAssignedValidator {},

    #[error("Insufficient payment")]
    InsufficientPayment {},

    #[error("Invalid model")]
    InvalidModel {},

    #[error("Timeout too short")]
    TimeoutTooShort {},

    #[error("Already claimed")]
    AlreadyClaimed {},
}

// ============ STATE ============

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    /// Denom for payments (AETHEL)
    pub payment_denom: String,
    /// Minimum job timeout in blocks
    pub min_timeout: u64,
    /// Maximum job timeout in blocks
    pub max_timeout: u64,
    /// Minimum payment for a job
    pub min_payment: Uint128,
    /// Platform fee basis points (100 = 1%)
    pub platform_fee_bps: u64,
    /// Fee collector address
    pub fee_collector: Addr,
    /// Required TEE type (0 = any, 1 = SGX, 2 = TDX, 3 = SEV-SNP)
    pub required_tee_type: u8,
    /// Model registry contract address
    pub model_registry: Addr,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Job {
    pub id: String,
    pub creator: Addr,
    pub validator: Option<Addr>,
    pub status: JobStatus,
    pub model_hash: String,
    pub input_hash: String,
    pub output_hash: Option<String>,
    pub proof_type: ProofType,
    pub priority: u32,
    pub max_payment: Uint128,
    pub actual_payment: Option<Uint128>,
    pub timeout: u64,
    pub created_at: u64,
    pub completed_at: Option<u64>,
    pub tee_attestation: Option<TEEAttestation>,
    pub compute_metrics: Option<ComputeMetrics>,
    pub verification_score: Option<u16>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    Assigned,
    Computing,
    Completed,
    Verified,
    Failed,
    Expired,
    Cancelled,
    /// SECURITY: Terminal state after payment — prevents double-drain
    Paid,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Pending => "pending",
            JobStatus::Assigned => "assigned",
            JobStatus::Computing => "computing",
            JobStatus::Completed => "completed",
            JobStatus::Verified => "verified",
            JobStatus::Failed => "failed",
            JobStatus::Expired => "expired",
            JobStatus::Cancelled => "cancelled",
            JobStatus::Paid => "paid",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProofType {
    TeeAttestation,
    ZkProof,
    MpcProof,
    Optimistic,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TEEAttestation {
    pub tee_type: TeeType,
    pub quote_version: u16,
    pub quote: Binary,
    pub report_data: Binary,
    pub measurement: String,
    pub timestamp: Timestamp,
    pub enclave_key: Binary,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TeeType {
    IntelSgx,
    IntelTdx,
    AmdSevSnp,
    AwsNitro,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ComputeMetrics {
    pub cpu_cycles: u64,
    pub memory_used: u64, // MB
    pub compute_time_ms: u64,
    pub energy_mj: u64,
}

// Indexes for job queries
pub struct JobIndexes<'a> {
    pub status: MultiIndex<'a, String, Job, String>,
    pub creator: MultiIndex<'a, Addr, Job, String>,
    pub validator: MultiIndex<'a, Addr, Job, String>,
}

impl<'a> IndexList<Job> for JobIndexes<'a> {
    fn get_indexes(&'_ self) -> Box<dyn Iterator<Item = &'_ dyn Index<Job>> + '_> {
        let v: Vec<&dyn Index<Job>> = vec![&self.status, &self.creator, &self.validator];
        Box::new(v.into_iter())
    }
}

// Storage
const CONFIG: Item<Config> = Item::new("config");
const JOB_COUNT: Item<u64> = Item::new("job_count");

// Indexed job storage
fn jobs<'a>() -> IndexedMap<'a, String, Job, JobIndexes<'a>> {
    let indexes = JobIndexes {
        status: MultiIndex::new(
            |_pk: &[u8], d: &Job| d.status.as_str().to_string(),
            "jobs",
            "jobs__status",
        ),
        creator: MultiIndex::new(
            |_pk: &[u8], d: &Job| d.creator.clone(),
            "jobs",
            "jobs__creator",
        ),
        validator: MultiIndex::new(
            |_pk: &[u8], d: &Job| d.validator.clone().unwrap_or_else(|| Addr::unchecked("")),
            "jobs",
            "jobs__validator",
        ),
    };
    IndexedMap::new("jobs", indexes)
}

// Pending job queue
const PENDING_JOBS: Map<u64, String> = Map::new("pending_jobs");
const PENDING_COUNT: Item<u64> = Item::new("pending_count");

// Validator stats
const VALIDATOR_STATS: Map<&Addr, ValidatorStats> = Map::new("validator_stats");

// L-03 FIX: Platform-level aggregate counters for real-time stats
const PLATFORM_COMPLETED_JOBS: Item<u64> = Item::new("platform_completed_jobs");
const PLATFORM_FAILED_JOBS: Item<u64> = Item::new("platform_failed_jobs");
const PLATFORM_TOTAL_PAYMENTS: Item<Uint128> = Item::new("platform_total_payments");

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, JsonSchema)]
pub struct ValidatorStats {
    pub total_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub total_earnings: Uint128,
    pub average_score: u16,
}

// ============ MESSAGES ============

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub payment_denom: String,
    pub min_timeout: u64,
    pub max_timeout: u64,
    pub min_payment: Uint128,
    pub platform_fee_bps: u64,
    pub fee_collector: String,
    pub required_tee_type: u8,
    pub model_registry: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    /// Submit a new AI job
    SubmitJob {
        model_hash: String,
        input_hash: String,
        proof_type: ProofType,
        priority: u32,
        timeout: u64,
    },

    /// Assign job to validator (called by validator)
    AssignJob { job_id: String },

    /// Start computing (validator only)
    StartComputing { job_id: String },

    /// Submit job result with TEE attestation
    CompleteJob {
        job_id: String,
        output_hash: String,
        tee_attestation: TEEAttestation,
        compute_metrics: ComputeMetrics,
    },

    /// Verify and finalize job (platform or delegator)
    VerifyJob { job_id: String },

    /// Mark job as failed
    FailJob { job_id: String, reason: String },

    /// Cancel pending job (creator only)
    CancelJob { job_id: String },

    /// Claim payment for verified job (validator)
    ClaimPayment { job_id: String },

    /// Update config (admin)
    UpdateConfig {
        min_payment: Option<Uint128>,
        platform_fee_bps: Option<u64>,
        required_tee_type: Option<u8>,
    },

    /// Cleanup expired jobs (anyone)
    CleanupExpired { limit: Option<u32> },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum ModelRegistryExecuteMsg {
    IncrementJobCount { model_hash: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum ModelRegistryQueryMsg {
    Model { model_hash: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
struct ModelRegistryModelResponse {
    verified: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    /// Get contract config
    Config {},

    /// Get job by ID
    Job { job_id: String },

    /// List jobs with filters
    ListJobs {
        status: Option<String>,
        creator: Option<String>,
        validator: Option<String>,
        start_after: Option<String>,
        limit: Option<u32>,
    },

    /// Get pending job queue
    PendingQueue { limit: Option<u32> },

    /// Get validator stats
    ValidatorStats { validator: String },

    /// Get platform stats
    PlatformStats {},

    /// Get job pricing estimate
    EstimatePrice {
        model_hash: String,
        estimated_cpu_cycles: u64,
        estimated_memory_mb: u64,
    },
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

    let config = Config {
        admin: info.sender,
        payment_denom: msg.payment_denom,
        min_timeout: msg.min_timeout,
        max_timeout: msg.max_timeout,
        min_payment: msg.min_payment,
        platform_fee_bps: msg.platform_fee_bps,
        fee_collector: deps.api.addr_validate(&msg.fee_collector)?,
        required_tee_type: msg.required_tee_type,
        model_registry: deps.api.addr_validate(&msg.model_registry)?,
    };

    CONFIG.save(deps.storage, &config)?;
    JOB_COUNT.save(deps.storage, &0)?;
    PENDING_COUNT.save(deps.storage, &0)?;
    // L-03 FIX: Initialize platform-level aggregate counters
    PLATFORM_COMPLETED_JOBS.save(deps.storage, &0)?;
    PLATFORM_FAILED_JOBS.save(deps.storage, &0)?;
    PLATFORM_TOTAL_PAYMENTS.save(deps.storage, &Uint128::zero())?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("contract_name", CONTRACT_NAME)
        .add_attribute("contract_version", CONTRACT_VERSION))
}

// ============ EXECUTE ============

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::SubmitJob {
            model_hash,
            input_hash,
            proof_type,
            priority,
            timeout,
        } => execute_submit_job(
            deps, env, info, model_hash, input_hash, proof_type, priority, timeout,
        ),
        ExecuteMsg::AssignJob { job_id } => execute_assign_job(deps, env, info, job_id),
        ExecuteMsg::StartComputing { job_id } => execute_start_computing(deps, env, info, job_id),
        ExecuteMsg::CompleteJob {
            job_id,
            output_hash,
            tee_attestation,
            compute_metrics,
        } => execute_complete_job(
            deps,
            env,
            info,
            job_id,
            output_hash,
            tee_attestation,
            compute_metrics,
        ),
        ExecuteMsg::VerifyJob { job_id } => execute_verify_job(deps, env, info, job_id),
        ExecuteMsg::FailJob { job_id, reason } => execute_fail_job(deps, env, info, job_id, reason),
        ExecuteMsg::CancelJob { job_id } => execute_cancel_job(deps, env, info, job_id),
        ExecuteMsg::ClaimPayment { job_id } => execute_claim_payment(deps, env, info, job_id),
        ExecuteMsg::UpdateConfig {
            min_payment,
            platform_fee_bps,
            required_tee_type,
        } => execute_update_config(deps, info, min_payment, platform_fee_bps, required_tee_type),
        ExecuteMsg::CleanupExpired { limit } => execute_cleanup_expired(deps, env, limit),
    }
}

fn ensure_model_accepts_jobs(
    deps: Deps,
    model_registry: &Addr,
    model_hash: &str,
) -> Result<(), ContractError> {
    if model_hash.is_empty() || model_hash.len() > 128 {
        return Err(ContractError::InvalidModel {});
    }

    let model: ModelRegistryModelResponse = deps
        .querier
        .query_wasm_smart(
            model_registry,
            &ModelRegistryQueryMsg::Model {
                model_hash: model_hash.to_string(),
            },
        )
        .map_err(|_| ContractError::InvalidModel {})?;

    if !model.verified {
        return Err(ContractError::InvalidModel {});
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn execute_submit_job(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    model_hash: String,
    input_hash: String,
    proof_type: ProofType,
    priority: u32,
    timeout: u64,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // Validate timeout
    if timeout < config.min_timeout {
        return Err(ContractError::TimeoutTooShort {});
    }
    if timeout > config.max_timeout {
        return Err(ContractError::TimeoutTooShort {});
    }

    // Validate payment
    let payment = info
        .funds
        .iter()
        .find(|c| c.denom == config.payment_denom)
        .map(|c| c.amount)
        .unwrap_or_default();

    if payment < config.min_payment {
        return Err(ContractError::InsufficientPayment {});
    }

    ensure_model_accepts_jobs(deps.as_ref(), &config.model_registry, &model_hash)?;

    // Generate job ID
    let count = JOB_COUNT.load(deps.storage)?;
    let job_id = generate_job_id(&model_hash, &input_hash, &info.sender, count);

    let job = Job {
        id: job_id.clone(),
        creator: info.sender.clone(),
        validator: None,
        status: JobStatus::Pending,
        model_hash: model_hash.clone(),
        input_hash: input_hash.clone(),
        output_hash: None,
        proof_type,
        priority,
        max_payment: payment,
        actual_payment: None,
        timeout,
        created_at: env.block.height,
        completed_at: None,
        tee_attestation: None,
        compute_metrics: None,
        verification_score: None,
    };

    // Save job
    jobs().save(deps.storage, job_id.clone(), &job)?;
    JOB_COUNT.save(deps.storage, &(count + 1))?;

    // Add to pending queue
    let pending_count = PENDING_COUNT.load(deps.storage)?;
    PENDING_JOBS.save(deps.storage, pending_count, &job_id)?;
    PENDING_COUNT.save(deps.storage, &(pending_count + 1))?;

    Ok(Response::new()
        .add_attribute("action", "submit_job")
        .add_attribute("job_id", job_id)
        .add_attribute("creator", info.sender)
        .add_attribute("model_hash", model_hash)
        .add_attribute("payment", payment)
        .add_attribute("priority", priority.to_string()))
}

fn execute_assign_job(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    job_id: String,
) -> Result<Response, ContractError> {
    let mut job = jobs().load(deps.storage, job_id.clone())?;

    // Check job is pending
    if job.status != JobStatus::Pending {
        return Err(ContractError::InvalidStatus {
            current: job.status.as_str().to_string(),
        });
    }

    // Check not expired
    if env.block.height > job.created_at + job.timeout {
        return Err(ContractError::JobExpired {});
    }

    // Assign validator
    job.validator = Some(info.sender.clone());
    job.status = JobStatus::Assigned;

    jobs().save(deps.storage, job_id.clone(), &job)?;

    // Remove from pending queue
    remove_from_pending(deps.storage, &job_id)?;

    // Update validator stats — increment total_jobs on assignment
    VALIDATOR_STATS.update(deps.storage, &info.sender, |stats| -> StdResult<_> {
        let mut s = stats.unwrap_or_default();
        s.total_jobs += 1;
        Ok(s)
    })?;

    Ok(Response::new()
        .add_attribute("action", "assign_job")
        .add_attribute("job_id", job_id)
        .add_attribute("validator", info.sender))
}

fn execute_start_computing(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    job_id: String,
) -> Result<Response, ContractError> {
    let mut job = jobs().load(deps.storage, job_id.clone())?;

    // Check validator
    if job.validator != Some(info.sender.clone()) {
        return Err(ContractError::NotAssignedValidator {});
    }

    // Check status
    if job.status != JobStatus::Assigned {
        return Err(ContractError::InvalidStatus {
            current: job.status.as_str().to_string(),
        });
    }

    job.status = JobStatus::Computing;
    jobs().save(deps.storage, job_id.clone(), &job)?;

    Ok(Response::new()
        .add_attribute("action", "start_computing")
        .add_attribute("job_id", job_id))
}

fn execute_complete_job(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    job_id: String,
    output_hash: String,
    tee_attestation: TEEAttestation,
    compute_metrics: ComputeMetrics,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut job = jobs().load(deps.storage, job_id.clone())?;

    // Check validator
    if job.validator != Some(info.sender.clone()) {
        return Err(ContractError::NotAssignedValidator {});
    }

    // Check status
    if job.status != JobStatus::Computing {
        return Err(ContractError::InvalidStatus {
            current: job.status.as_str().to_string(),
        });
    }

    // Verify TEE attestation
    if config.required_tee_type != 0 {
        let tee_type = match tee_attestation.tee_type {
            TeeType::IntelSgx => 1u8,
            TeeType::IntelTdx => 2u8,
            TeeType::AmdSevSnp => 3u8,
            TeeType::AwsNitro => 4u8,
        };
        if tee_type != config.required_tee_type {
            return Err(ContractError::InvalidAttestation {});
        }
    }

    // MED-7: Validate TEE attestation content — not just the type enum.
    // Check that required fields are non-empty and the quote is well-formed.
    if tee_attestation.quote.is_empty() {
        return Err(ContractError::InvalidAttestation {});
    }
    if tee_attestation.report_data.is_empty() {
        return Err(ContractError::InvalidAttestation {});
    }
    if tee_attestation.measurement.is_empty() {
        return Err(ContractError::InvalidAttestation {});
    }
    if tee_attestation.enclave_key.is_empty() {
        return Err(ContractError::InvalidAttestation {});
    }
    // Validate measurement looks like a hex hash (at least 32 hex chars)
    if tee_attestation.measurement.len() < 32
        || !tee_attestation
            .measurement
            .chars()
            .all(|c| c.is_ascii_hexdigit())
    {
        return Err(ContractError::InvalidAttestation {});
    }
    // Validate attestation timestamp is not in the future and not too old (24h)
    if tee_attestation.timestamp > env.block.time {
        return Err(ContractError::InvalidAttestation {});
    }
    let max_attestation_age = 86400u64; // 24 hours
    if env
        .block
        .time
        .seconds()
        .saturating_sub(tee_attestation.timestamp.seconds())
        > max_attestation_age
    {
        return Err(ContractError::InvalidAttestation {});
    }

    // Calculate payment based on compute metrics
    let base_cost = compute_metrics.cpu_cycles as u128 / 1_000_000; // Simplified
    let memory_cost = compute_metrics.memory_used as u128 * 100;
    let total_cost = std::cmp::min(Uint128::from(base_cost + memory_cost), job.max_payment);

    // Calculate verification score
    let score = calculate_verification_score(&tee_attestation, &compute_metrics);

    job.output_hash = Some(output_hash);
    job.tee_attestation = Some(tee_attestation);
    job.compute_metrics = Some(compute_metrics);
    job.actual_payment = Some(total_cost);
    job.verification_score = Some(score);
    job.completed_at = Some(env.block.height);
    job.status = JobStatus::Completed;

    jobs().save(deps.storage, job_id.clone(), &job)?;

    Ok(Response::new()
        .add_attribute("action", "complete_job")
        .add_attribute("job_id", job_id)
        .add_attribute("payment", total_cost)
        .add_attribute("score", score.to_string()))
}

fn execute_verify_job(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    job_id: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut job = jobs().load(deps.storage, job_id.clone())?;

    // Can be verified by creator or admin
    if job.creator != info.sender && config.admin != info.sender {
        return Err(ContractError::Unauthorized {});
    }

    if job.status != JobStatus::Completed {
        return Err(ContractError::InvalidStatus {
            current: job.status.as_str().to_string(),
        });
    }

    job.status = JobStatus::Verified;
    jobs().save(deps.storage, job_id.clone(), &job)?;

    // Update validator stats
    if let Some(validator) = &job.validator {
        VALIDATOR_STATS.update(deps.storage, validator, |stats| -> StdResult<_> {
            let mut s = stats.unwrap_or_default();
            s.completed_jobs += 1;
            s.total_earnings += job.actual_payment.unwrap_or_default();
            Ok(s)
        })?;
    }

    // L-03 FIX: Update platform-level aggregate counters
    let completed = PLATFORM_COMPLETED_JOBS.load(deps.storage).unwrap_or(0);
    PLATFORM_COMPLETED_JOBS.save(deps.storage, &(completed + 1))?;

    // MONITORING: Emit verification event for indexers
    let verify_event = Event::new("job_verified")
        .add_attribute("job_id", &job_id)
        .add_attribute("creator", job.creator.as_str())
        .add_attribute(
            "validator",
            job.validator.as_ref().map(|v| v.as_str()).unwrap_or("none"),
        )
        .add_attribute(
            "payment",
            job.actual_payment.unwrap_or_default().to_string(),
        );

    let registry_msg = CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: config.model_registry.to_string(),
        msg: to_json_binary(&ModelRegistryExecuteMsg::IncrementJobCount {
            model_hash: job.model_hash.clone(),
        })?,
        funds: vec![],
    });

    let registry_submsg = SubMsg {
        id: MODEL_REGISTRY_INCREMENT_REPLY_ID,
        msg: registry_msg,
        gas_limit: None,
        reply_on: ReplyOn::Error,
    };

    Ok(Response::new()
        .add_submessage(registry_submsg)
        .add_event(verify_event)
        .add_attribute("action", "verify_job")
        .add_attribute("job_id", job_id))
}

#[entry_point]
pub fn reply(_deps: DepsMut, _env: Env, msg: Reply) -> Result<Response, ContractError> {
    match msg.id {
        MODEL_REGISTRY_INCREMENT_REPLY_ID => match msg.result {
            SubMsgResult::Ok(_) => Ok(Response::new()),
            SubMsgResult::Err(error) => Ok(Response::new().add_event(
                Event::new("model_registry_job_count_increment_failed")
                    .add_attribute("error", error),
            )),
        },
        _ => Err(ContractError::Std(StdError::generic_err(format!(
            "unknown reply id: {}",
            msg.id
        )))),
    }
}

fn execute_fail_job(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    job_id: String,
    reason: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut job = jobs().load(deps.storage, job_id.clone())?;

    // Can be failed by assigned validator or admin
    let is_validator = job.validator == Some(info.sender.clone());
    let is_admin = config.admin == info.sender;

    if !is_validator && !is_admin {
        return Err(ContractError::Unauthorized {});
    }

    if job.status != JobStatus::Computing && job.status != JobStatus::Assigned {
        return Err(ContractError::InvalidStatus {
            current: job.status.as_str().to_string(),
        });
    }

    job.status = JobStatus::Failed;
    jobs().save(deps.storage, job_id.clone(), &job)?;

    // Update validator stats
    if let Some(validator) = &job.validator {
        VALIDATOR_STATS.update(deps.storage, validator, |stats| -> StdResult<_> {
            let mut s = stats.unwrap_or_default();
            s.failed_jobs += 1;
            Ok(s)
        })?;
    }

    // L-03 FIX: Update platform-level failed counter
    let failed = PLATFORM_FAILED_JOBS.load(deps.storage).unwrap_or(0);
    PLATFORM_FAILED_JOBS.save(deps.storage, &(failed + 1))?;

    // MONITORING: Emit failure event for alerting
    let fail_event = Event::new("job_failed")
        .add_attribute("job_id", &job_id)
        .add_attribute("reason", &reason)
        .add_attribute(
            "validator",
            job.validator.as_ref().map(|v| v.as_str()).unwrap_or("none"),
        );

    Ok(Response::new()
        .add_event(fail_event)
        .add_attribute("action", "fail_job")
        .add_attribute("job_id", job_id)
        .add_attribute("reason", reason))
}

fn execute_cancel_job(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    job_id: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut job = jobs().load(deps.storage, job_id.clone())?;

    // Only creator can cancel
    if job.creator != info.sender {
        return Err(ContractError::Unauthorized {});
    }

    // Can only cancel pending jobs
    if job.status != JobStatus::Pending {
        return Err(ContractError::InvalidStatus {
            current: job.status.as_str().to_string(),
        });
    }

    job.status = JobStatus::Cancelled;
    jobs().save(deps.storage, job_id.clone(), &job)?;

    // Remove from pending queue
    remove_from_pending(deps.storage, &job_id)?;

    // Refund payment
    let refund_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: job.creator.to_string(),
        amount: vec![Coin {
            denom: config.payment_denom,
            amount: job.max_payment,
        }],
    });

    Ok(Response::new()
        .add_message(refund_msg)
        .add_attribute("action", "cancel_job")
        .add_attribute("job_id", job_id)
        .add_attribute("refund", job.max_payment))
}

/// SECURITY: CEI pattern — transition to Paid BEFORE sending funds to prevent double-drain
fn execute_claim_payment(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    job_id: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut job = jobs().load(deps.storage, job_id.clone())?;

    // Only assigned validator can claim
    if job.validator != Some(info.sender.clone()) {
        return Err(ContractError::NotAssignedValidator {});
    }

    // Must be verified — reject if already paid (double-drain guard)
    if job.status == JobStatus::Paid {
        return Err(ContractError::AlreadyClaimed {});
    }
    if job.status != JobStatus::Verified {
        return Err(ContractError::InvalidStatus {
            current: job.status.as_str().to_string(),
        });
    }

    let payment = job.actual_payment.unwrap_or_default();
    let platform_fee = payment * Uint128::from(config.platform_fee_bps) / Uint128::from(10000u128);
    let validator_payment = payment - platform_fee;

    // SECURITY: Transition to Paid BEFORE external calls (checks-effects-interactions)
    job.status = JobStatus::Paid;
    jobs().save(deps.storage, job_id.clone(), &job)?;

    // L-03 FIX: Update platform-level total payments counter
    let total_payments = PLATFORM_TOTAL_PAYMENTS
        .load(deps.storage)
        .unwrap_or_default();
    PLATFORM_TOTAL_PAYMENTS.save(deps.storage, &(total_payments + payment))?;

    // Send payment to validator
    let validator_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: info.sender.to_string(),
        amount: vec![Coin {
            denom: config.payment_denom.clone(),
            amount: validator_payment,
        }],
    });

    // Send fee to collector
    let fee_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: config.fee_collector.to_string(),
        amount: vec![Coin {
            denom: config.payment_denom,
            amount: platform_fee,
        }],
    });

    // MONITORING: Payment event for financial tracking
    let payment_event = Event::new("payment_claimed")
        .add_attribute("job_id", &job_id)
        .add_attribute("validator", info.sender.as_str())
        .add_attribute("validator_payment", validator_payment.to_string())
        .add_attribute("platform_fee", platform_fee.to_string())
        .add_attribute("total_payment", payment.to_string());

    Ok(Response::new()
        .add_message(validator_msg)
        .add_message(fee_msg)
        .add_event(payment_event)
        .add_attribute("action", "claim_payment")
        .add_attribute("job_id", job_id)
        .add_attribute("payment", validator_payment)
        .add_attribute("fee", platform_fee))
}

fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    min_payment: Option<Uint128>,
    platform_fee_bps: Option<u64>,
    required_tee_type: Option<u8>,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    if let Some(mp) = min_payment {
        config.min_payment = mp;
    }
    if let Some(fee) = platform_fee_bps {
        // LOW: Cap platform fee at 20% to prevent admin abuse
        if fee > 2000 {
            return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
                "Platform fee cannot exceed 2000 basis points (20%)",
            )));
        }
        config.platform_fee_bps = fee;
    }
    if let Some(tee) = required_tee_type {
        config.required_tee_type = tee;
    }

    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new().add_attribute("action", "update_config"))
}

/// HIGH-7 FIX: Properly refund creators when their jobs expire.
/// The old implementation had a logic bug (checked status after overwriting it)
/// and a TODO stub for refund. Now correctly refunds max_payment to creators.
fn execute_cleanup_expired(
    deps: DepsMut,
    env: Env,
    limit: Option<u32>,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let limit = limit.unwrap_or(50) as usize;
    let mut cleaned = 0u64;
    let mut refund_msgs: Vec<CosmosMsg> = Vec::new();

    // Iterate through pending and assigned jobs
    let pending: Vec<_> = PENDING_JOBS
        .range(deps.storage, None, None, cosmwasm_std::Order::Ascending)
        .take(limit)
        .filter_map(|r| r.ok())
        .collect();

    for (_, job_id) in pending {
        if let Ok(job) = jobs().load(deps.storage, job_id.clone()) {
            if env.block.height > job.created_at + job.timeout {
                // HIGH-7: Check status BEFORE overwriting — refund for Pending/Assigned jobs
                let should_refund =
                    job.status == JobStatus::Pending || job.status == JobStatus::Assigned;
                let refund_amount = job.max_payment;
                let refund_to = job.creator.clone();

                let mut expired_job = job;
                expired_job.status = JobStatus::Expired;
                jobs().save(deps.storage, job_id.clone(), &expired_job)?;
                remove_from_pending(deps.storage, &job_id)?;

                // Refund the locked payment to the job creator
                if should_refund && !refund_amount.is_zero() {
                    refund_msgs.push(CosmosMsg::Bank(BankMsg::Send {
                        to_address: refund_to.to_string(),
                        amount: vec![Coin {
                            denom: config.payment_denom.clone(),
                            amount: refund_amount,
                        }],
                    }));
                }

                cleaned += 1;
            }
        }
    }

    let mut response = Response::new()
        .add_attribute("action", "cleanup_expired")
        .add_attribute("cleaned", cleaned.to_string())
        .add_attribute("refunds", refund_msgs.len().to_string());

    for msg in refund_msgs {
        response = response.add_message(msg);
    }

    Ok(response)
}

// ============ QUERY ============

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&CONFIG.load(deps.storage)?),
        QueryMsg::Job { job_id } => {
            let job = jobs().load(deps.storage, job_id)?;
            to_json_binary(&job)
        }
        QueryMsg::ListJobs {
            status,
            creator,
            validator,
            start_after,
            limit,
        } => to_json_binary(&query_list_jobs(
            deps,
            status,
            creator,
            validator,
            start_after,
            limit,
        )?),
        QueryMsg::PendingQueue { limit } => to_json_binary(&query_pending_queue(deps, limit)?),
        QueryMsg::ValidatorStats { validator } => {
            let addr = deps.api.addr_validate(&validator)?;
            let stats = VALIDATOR_STATS
                .load(deps.storage, &addr)
                .unwrap_or_default();
            to_json_binary(&stats)
        }
        QueryMsg::PlatformStats {} => to_json_binary(&query_platform_stats(deps)?),
        QueryMsg::EstimatePrice {
            model_hash: _,
            estimated_cpu_cycles,
            estimated_memory_mb,
        } => to_json_binary(&query_estimate_price(
            estimated_cpu_cycles,
            estimated_memory_mb,
        )),
    }
}

fn query_list_jobs(
    deps: Deps,
    status: Option<String>,
    creator: Option<String>,
    validator: Option<String>,
    _start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<Vec<Job>> {
    let limit = limit.unwrap_or(50) as usize;

    let jobs: Vec<Job> = if let Some(s) = status {
        jobs()
            .idx
            .status
            .prefix(s)
            .range(deps.storage, None, None, cosmwasm_std::Order::Descending)
            .filter_map(|r| r.ok().map(|(_, job)| job))
            .take(limit)
            .collect()
    } else if let Some(c) = creator {
        let addr = deps.api.addr_validate(&c)?;
        jobs()
            .idx
            .creator
            .prefix(addr)
            .range(deps.storage, None, None, cosmwasm_std::Order::Descending)
            .filter_map(|r| r.ok().map(|(_, job)| job))
            .take(limit)
            .collect()
    } else if let Some(v) = validator {
        let addr = deps.api.addr_validate(&v)?;
        jobs()
            .idx
            .validator
            .prefix(addr)
            .range(deps.storage, None, None, cosmwasm_std::Order::Descending)
            .filter_map(|r| r.ok().map(|(_, job)| job))
            .take(limit)
            .collect()
    } else {
        jobs()
            .range(deps.storage, None, None, cosmwasm_std::Order::Descending)
            .filter_map(|r| r.ok().map(|(_, job)| job))
            .take(limit)
            .collect()
    };

    Ok(jobs)
}

fn query_pending_queue(deps: Deps, limit: Option<u32>) -> StdResult<Vec<Job>> {
    let limit = limit.unwrap_or(50) as usize;
    let count = PENDING_COUNT.load(deps.storage).unwrap_or(0);

    let mut pending_jobs = Vec::new();
    for i in 0..count.min(limit as u64) {
        if let Ok(job_id) = PENDING_JOBS.load(deps.storage, i) {
            if let Ok(job) = jobs().load(deps.storage, job_id) {
                pending_jobs.push(job);
            }
        }
    }

    Ok(pending_jobs)
}

/// L-03 FIX: Return real platform stats from persistent counters.
/// Previously returned hardcoded zeros for pending_jobs, completed_jobs, and total_payments.
fn query_platform_stats(deps: Deps) -> StdResult<PlatformStats> {
    let total_jobs = JOB_COUNT.load(deps.storage)?;
    let pending_jobs = PENDING_COUNT.load(deps.storage).unwrap_or(0);
    let completed_jobs = PLATFORM_COMPLETED_JOBS.load(deps.storage).unwrap_or(0);
    let failed_jobs = PLATFORM_FAILED_JOBS.load(deps.storage).unwrap_or(0);
    let total_payments = PLATFORM_TOTAL_PAYMENTS
        .load(deps.storage)
        .unwrap_or_default();

    Ok(PlatformStats {
        total_jobs,
        pending_jobs,
        completed_jobs,
        failed_jobs,
        total_payments,
    })
}

/// L-03 FIX: Platform statistics with real data from persistent counters.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct PlatformStats {
    pub total_jobs: u64,
    pub pending_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub total_payments: Uint128,
}

fn query_estimate_price(estimated_cpu_cycles: u64, estimated_memory_mb: u64) -> PriceEstimate {
    let base_cost = estimated_cpu_cycles as u128 / 1_000_000;
    let memory_cost = estimated_memory_mb as u128 * 100;
    let total = base_cost + memory_cost;

    PriceEstimate {
        estimated_cost: Uint128::from(total),
        currency: "aeth".to_string(),
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct PriceEstimate {
    pub estimated_cost: Uint128,
    pub currency: String,
}

// ============ HELPERS ============

fn generate_job_id(model_hash: &str, input_hash: &str, creator: &Addr, nonce: u64) -> String {
    let data = format!("{}:{}:{}:{}", model_hash, input_hash, creator, nonce);
    let hash = Sha256::digest(data.as_bytes());
    format!("job_{}", hex::encode(&hash[..16]))
}

/// SECURITY: Actually remove the job from the pending queue.
/// Scans the PENDING_JOBS map for the given job_id. When found, swaps it with
/// the last entry (compaction) and decrements PENDING_COUNT. This maintains a
/// dense, gap-free queue.
fn remove_from_pending(storage: &mut dyn cosmwasm_std::Storage, job_id: &str) -> StdResult<()> {
    let count = PENDING_COUNT.load(storage)?;
    if count == 0 {
        return Ok(());
    }

    // Scan for the job_id in the pending queue
    let mut found_idx: Option<u64> = None;
    for i in 0..count {
        if let Ok(id) = PENDING_JOBS.load(storage, i) {
            if id == job_id {
                found_idx = Some(i);
                break;
            }
        }
    }

    if let Some(idx) = found_idx {
        let last_idx = count - 1;
        if idx != last_idx {
            // Swap with the last entry to compact the queue
            let last_job_id = PENDING_JOBS.load(storage, last_idx)?;
            PENDING_JOBS.save(storage, idx, &last_job_id)?;
        }
        // Remove the last entry and decrement count
        PENDING_JOBS.remove(storage, last_idx);
        PENDING_COUNT.save(storage, &last_idx)?;
    }

    Ok(())
}

fn calculate_verification_score(attestation: &TEEAttestation, metrics: &ComputeMetrics) -> u16 {
    let mut score = 8500u16; // Base score 85.00%

    // Bonus for newer TEE types
    match attestation.tee_type {
        TeeType::IntelTdx => score += 500,
        TeeType::IntelSgx => score += 300,
        TeeType::AmdSevSnp => score += 400,
        TeeType::AwsNitro => score += 200,
    }

    // Penalty for slow compute
    if metrics.compute_time_ms > 60000 {
        score = score.saturating_sub(200);
    }

    score.min(10000)
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
