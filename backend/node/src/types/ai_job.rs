//! AI Job types for Aethelred blockchain
//! 
//! AI jobs represent verifiable inference requests that validators execute
//! in TEE (Trusted Execution Environment) with cryptographic proofs.

use super::{Hash, Address, Amount, Timestamp, ProofType, AethelredError};
use serde::{Deserialize, Serialize};

/// AI Job status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum JobStatus {
    /// Job submitted, waiting for assignment
    Pending = 0,
    /// Job assigned to validator
    Assigned = 1,
    /// Validator computing inference
    Computing = 2,
    /// Computation complete, pending verification
    Completed = 3,
    /// Job verified and sealed
    Verified = 4,
    /// Verification failed
    Failed = 5,
    /// Job expired (timeout)
    Expired = 6,
    /// Job cancelled by requester
    Cancelled = 7,
}

impl fmt::Display for JobStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JobStatus::Pending => write!(f, "Pending"),
            JobStatus::Assigned => write!(f, "Assigned"),
            JobStatus::Computing => write!(f, "Computing"),
            JobStatus::Completed => write!(f, "Completed"),
            JobStatus::Verified => write!(f, "Verified"),
            JobStatus::Failed => write!(f, "Failed"),
            JobStatus::Expired => write!(f, "Expired"),
            JobStatus::Cancelled => write!(f, "Cancelled"),
        }
    }
}

/// AI Job structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIJob {
    /// Unique job ID
    pub id: Hash,
    /// Job status
    pub status: JobStatus,
    /// Model hash (identifier of the model to use)
    pub model_hash: Hash,
    /// Input data hash (commitment)
    pub input_hash: Hash,
    /// Output data hash (computed result)
    pub output_hash: Option<Hash>,
    /// Job creator/requester
    pub creator: Address,
    /// Assigned validator
    pub validator: Option<Address>,
    /// Type of proof required
    pub proof_type: ProofType,
    /// Priority level (higher = more urgent)
    pub priority: u32,
    /// Maximum cost willing to pay
    pub max_cost: Amount,
    /// Actual cost paid
    pub actual_cost: Option<Amount>,
    /// Job timeout in blocks
    pub timeout: u64,
    /// Block height when submitted
    pub created_at: u64,
    /// Block height when completed
    pub completed_at: Option<u64>,
    /// TEE attestation data
    pub tee_attestation: Option<TEEAttestation>,
    /// Verification proof
    pub verification_proof: Option<VerificationProof>,
    /// Compute metrics
    pub compute_metrics: Option<ComputeMetrics>,
    /// Verification score (0-10000 representing 0.00-100.00%)
    pub verification_score: Option<u16>,
}

impl AIJob {
    /// Create a new AI job
    pub fn new(
        model_hash: Hash,
        input_hash: Hash,
        creator: Address,
        proof_type: ProofType,
        priority: u32,
        max_cost: Amount,
        timeout: u64,
        current_height: u64,
    ) -> Self {
        // Compute job ID as hash of inputs
        let mut hasher_data = Vec::new();
        hasher_data.extend_from_slice(model_hash.as_bytes());
        hasher_data.extend_from_slice(input_hash.as_bytes());
        hasher_data.extend_from_slice(creator.as_str().as_bytes());
        hasher_data.extend_from_slice(&current_height.to_le_bytes());
        
        let id = Hash::new(&hasher_data);
        
        Self {
            id,
            status: JobStatus::Pending,
            model_hash,
            input_hash,
            output_hash: None,
            creator,
            validator: None,
            proof_type,
            priority,
            max_cost,
            actual_cost: None,
            timeout,
            created_at: current_height,
            completed_at: None,
            tee_attestation: None,
            verification_proof: None,
            compute_metrics: None,
            verification_score: None,
        }
    }
    
    /// Assign job to a validator
    pub fn assign(&mut self, validator: Address, current_height: u64) -> Result<(), AethelredError> {
        if self.status != JobStatus::Pending {
            return Err(AethelredError::JobError(
                format!("Cannot assign job in status: {:?}", self.status)
            ));
        }
        
        if current_height > self.created_at + self.timeout {
            self.status = JobStatus::Expired;
            return Err(AethelredError::JobError("Job expired".to_string()));
        }
        
        self.validator = Some(validator);
        self.status = JobStatus::Assigned;
        Ok(())
    }
    
    /// Start computing
    pub fn start_computing(&mut self) -> Result<(), AethelredError> {
        if self.status != JobStatus::Assigned {
            return Err(AethelredError::JobError(
                format!("Cannot start computing in status: {:?}", self.status)
            ));
        }
        
        self.status = JobStatus::Computing;
        Ok(())
    }
    
    /// Complete job with output
    pub fn complete(
        &mut self,
        output_hash: Hash,
        tee_attestation: TEEAttestation,
        verification_proof: VerificationProof,
        compute_metrics: ComputeMetrics,
        current_height: u64,
    ) -> Result<(), AethelredError> {
        if self.status != JobStatus::Computing {
            return Err(AethelredError::JobError(
                format!("Cannot complete job in status: {:?}", self.status)
            ));
        }
        
        self.output_hash = Some(output_hash);
        self.tee_attestation = Some(tee_attestation);
        self.verification_proof = Some(verification_proof);
        self.compute_metrics = Some(compute_metrics);
        self.completed_at = Some(current_height);
        self.status = JobStatus::Completed;
        
        // Calculate verification score based on attestation
        self.verification_score = Some(self.calculate_verification_score()?);
        
        Ok(())
    }
    
    /// Verify and finalize job
    pub fn verify(&mut self, actual_cost: Amount) -> Result<(), AethelredError> {
        if self.status != JobStatus::Completed {
            return Err(AethelredError::JobError(
                format!("Cannot verify job in status: {:?}", self.status)
            ));
        }
        
        self.actual_cost = Some(actual_cost);
        self.status = JobStatus::Verified;
        Ok(())
    }
    
    /// Mark job as failed
    pub fn fail(&mut self, current_height: u64) -> Result<(), AethelredError> {
        if self.status != JobStatus::Computing && self.status != JobStatus::Assigned {
            return Err(AethelredError::JobError(
                format!("Cannot fail job in status: {:?}", self.status)
            ));
        }
        
        self.completed_at = Some(current_height);
        self.status = JobStatus::Failed;
        Ok(())
    }
    
    /// Cancel job (only by creator, only if pending)
    pub fn cancel(&mut self, caller: &Address) -> Result<(), AethelredError> {
        if self.creator != *caller {
            return Err(AethelredError::JobError("Only creator can cancel".to_string()));
        }
        
        if self.status != JobStatus::Pending {
            return Err(AethelredError::JobError(
                format!("Cannot cancel job in status: {:?}", self.status)
            ));
        }
        
        self.status = JobStatus::Cancelled;
        Ok(())
    }
    
    /// Check if job has expired
    pub fn is_expired(&self, current_height: u64) -> bool {
        current_height > self.created_at + self.timeout && 
        !matches!(self.status, JobStatus::Verified | JobStatus::Failed | JobStatus::Cancelled)
    }
    
    /// Calculate verification score based on attestation quality
    fn calculate_verification_score(&self) -> Result<u16, AethelredError> {
        let attestation = self.tee_attestation.as_ref()
            .ok_or_else(|| AethelredError::JobError("Missing attestation".to_string()))?;
        
        // Base score
        let mut score: u16 = 8500; // Start at 85.00%
        
        // Bonus for newer TEE version
        match attestation.tee_type {
            TEEType::IntelTDX => score += 500,
            TEEType::IntelSGX => score += 300,
            TEEType::AMDSEVSNP => score += 400,
            TEEType::AWSNitro => score += 200,
            TEEType::AzureSEVSNP => score += 400,
        }
        
        // Penalty for older quote version
        if attestation.quote_version < 3 {
            score = score.saturating_sub(200);
        }
        
        // Ensure within bounds
        score = score.min(10000);
        
        Ok(score)
    }
    
    /// Get cost per compute unit
    pub fn cost_per_compute_unit(&self) -> Option<Amount> {
        let metrics = self.compute_metrics.as_ref()?;
        let cost = self.actual_cost?;
        
        let total_units = metrics.cpu_cycles + metrics.memory_used * 1000;
        if total_units == 0 {
            return None;
        }
        
        cost.checked_div(Amount::from_raw(total_units))
    }
}

/// TEE Attestation data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TEEAttestation {
    /// TEE type
    pub tee_type: TEEType,
    /// Quote version
    pub quote_version: u16,
    /// Raw attestation quote
    pub quote: Vec<u8>,
    /// Report data (includes input/output hashes)
    pub report_data: Vec<u8>,
    /// MRENCLAVE/MRSIGNER measurement
    pub measurement: Hash,
    /// Timestamp of attestation
    pub timestamp: Timestamp,
    /// Validator enclave public key
    pub enclave_key: Vec<u8>,
}

/// TEE Type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum TEEType {
    IntelSGX = 0,
    IntelTDX = 1,
    AMDSEVSNP = 2,
    AWSNitro = 3,
    AzureSEVSNP = 4,
}

impl fmt::Display for TEEType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TEEType::IntelSGX => write!(f, "Intel SGX"),
            TEEType::IntelTDX => write!(f, "Intel TDX"),
            TEEType::AMDSEVSNP => write!(f, "AMD SEV-SNP"),
            TEEType::AWSNitro => write!(f, "AWS Nitro"),
            TEEType::AzureSEVSNP => write!(f, "Azure SEV-SNP"),
        }
    }
}

/// Verification proof
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationProof {
    /// Type of proof
    pub proof_type: ProofType,
    /// ZK proof data (if applicable)
    pub zk_proof: Option<Vec<u8>>,
    /// MPC proof commitment (if applicable)
    pub mpc_commitment: Option<Hash>,
    /// Optimistic challenge window start (if applicable)
    pub challenge_start: Option<u64>,
    /// Signatures from validators
    pub validator_signatures: Vec<ValidatorSignature>,
    /// Merkle proof of inclusion
    pub merkle_proof: MerkleProof,
}

/// Validator signature for verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorSignature {
    pub validator_address: Address,
    pub signature: Vec<u8>,
    pub timestamp: Timestamp,
}

/// Merkle proof structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleProof {
    pub root: Hash,
    pub path: Vec<Hash>,
    pub index: u64,
}

/// Compute metrics for the job
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeMetrics {
    /// CPU cycles consumed
    pub cpu_cycles: u64,
    /// Memory used (MB)
    pub memory_used: u64,
    /// Compute time in milliseconds
    pub compute_time_ms: u64,
    /// Energy consumed (millijoules)
    pub energy_mj: u64,
}

/// Job queue for pending jobs
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JobQueue {
    /// Jobs ordered by priority and submission time
    pub jobs: Vec<QueuedJob>,
}

/// Queued job entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedJob {
    pub job_id: Hash,
    pub priority: u32,
    pub submitted_at: u64,
    pub max_cost: Amount,
}

impl JobQueue {
    /// Add job to queue
    pub fn push(&mut self, job_id: Hash, priority: u32, submitted_at: u64, max_cost: Amount) {
        self.jobs.push(QueuedJob {
            job_id,
            priority,
            submitted_at,
            max_cost,
        });
        // Sort by priority (desc), then by submitted_at (asc)
        self.jobs.sort_by(|a, b| {
            b.priority.cmp(&a.priority)
                .then_with(|| a.submitted_at.cmp(&b.submitted_at))
        });
    }
    
    /// Get next job for assignment
    pub fn pop(&mut self) -> Option<Hash> {
        self.jobs.pop().map(|j| j.job_id)
    }
    
    /// Remove job from queue
    pub fn remove(&mut self, job_id: &Hash) -> bool {
        let len_before = self.jobs.len();
        self.jobs.retain(|j| &j.job_id != job_id);
        self.jobs.len() < len_before
    }
    
    /// Get queue length
    pub fn len(&self) -> usize {
        self.jobs.len()
    }
    
    pub fn is_empty(&self) -> bool {
        self.jobs.is_empty()
    }
}

/// Job statistics for analytics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStats {
    pub total_jobs: u64,
    pub pending_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub total_compute_cycles: u128,
    pub total_rewards_distributed: Amount,
    pub average_verification_score: f64,
    pub average_compute_time_ms: u64,
}

impl Default for JobStats {
    fn default() -> Self {
        Self {
            total_jobs: 0,
            pending_jobs: 0,
            completed_jobs: 0,
            failed_jobs: 0,
            total_compute_cycles: 0,
            total_rewards_distributed: Amount::from_raw(0),
            average_verification_score: 0.0,
            average_compute_time_ms: 0,
        }
    }
}

/// Job pricing oracle response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobPricing {
    /// Base price per compute unit
    pub base_price: Amount,
    /// Priority multiplier (1.0 = normal)
    pub priority_multiplier: f64,
    /// Model complexity multiplier
    pub model_multiplier: f64,
    /// Current network load (0.0 - 1.0)
    pub network_load: f64,
    /// Suggested max cost for job
    pub suggested_max_cost: Amount,
}

impl JobPricing {
    /// Calculate estimated cost for a job
    pub fn estimate_cost(&self, estimated_cpu_cycles: u64, estimated_memory_mb: u64) -> Amount {
        let compute_units = (estimated_cpu_cycles + estimated_memory_mb * 1000) as f64;
        let adjusted_price = self.base_price.human() * self.priority_multiplier * self.model_multiplier;
        let cost = (compute_units * adjusted_price) as u128;
        Amount::from_raw(cost)
    }
}

use std::fmt;
