//! Transaction types for Aethelred blockchain

use super::{Hash, Address, Amount, Timestamp, AethelredError, ProofType};
use serde::{Deserialize, Serialize};

/// Transaction structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    /// Transaction hash
    pub hash: Hash,
    /// Transaction body
    pub body: TxBody,
    /// Auth info (signatures, fees)
    pub auth_info: AuthInfo,
    /// Signatures
    pub signatures: Vec<Vec<u8>>,
    /// Metadata (set during execution)
    #[serde(skip)]
    pub metadata: TxMetadata,
}

/// Transaction metadata (execution context)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TxMetadata {
    pub block_height: u64,
    pub block_time: Timestamp,
    pub gas_used: u64,
    pub gas_wanted: u64,
    pub status: TxStatus,
    pub logs: Vec<Event>,
    pub code: u32,
    pub raw_log: String,
}

impl Transaction {
    /// Create a new transaction
    pub fn new(body: TxBody, auth_info: AuthInfo) -> Self {
        let tx_raw = TxRaw {
            body_bytes: bincode::serialize(&body).expect("Body serialization failed"),
            auth_info_bytes: bincode::serialize(&auth_info).expect("Auth info serialization failed"),
        };
        
        let hash = Hash::new(&bincode::serialize(&tx_raw).expect("TxRaw serialization failed"));
        
        Self {
            hash,
            body,
            auth_info,
            signatures: vec![],
            metadata: TxMetadata::default(),
        }
    }
    
    /// Compute transaction hash
    pub fn compute_hash(&self) -> Hash {
        let tx_raw = TxRaw {
            body_bytes: bincode::serialize(&self.body).expect("Body serialization failed"),
            auth_info_bytes: bincode::serialize(&self.auth_info).expect("Auth info serialization failed"),
        };
        Hash::new(&bincode::serialize(&tx_raw).expect("TxRaw serialization failed"))
    }
    
    /// Sign the transaction
    pub fn sign(&mut self, signature: Vec<u8>) {
        self.signatures.push(signature);
    }
    
    /// Validate basic transaction properties
    pub fn validate_basic(&self) -> Result<(), AethelredError> {
        // Check memo length
        if self.body.memo.len() > 256 {
            return Err(AethelredError::TxError("Memo too long".to_string()));
        }
        
        // Check messages
        if self.body.messages.is_empty() {
            return Err(AethelredError::TxError("No messages in transaction".to_string()));
        }
        
        if self.body.messages.len() > 100 {
            return Err(AethelredError::TxError("Too many messages".to_string()));
        }
        
        // Check timeout
        if let Some(timeout) = self.body.timeout_height {
            // Should be checked against current height in context
        }
        
        // Check fee
        if self.auth_info.fee.amount.raw() == 0 {
            return Err(AethelredError::TxError("Zero fee not allowed".to_string()));
        }
        
        // Check signer info matches signatures
        if self.auth_info.signer_infos.len() != self.signatures.len() {
            return Err(AethelredError::TxError(
                "Signer count doesn't match signature count".to_string()
            ));
        }
        
        Ok(())
    }
    
    /// Get fee amount
    pub fn fee(&self) -> Amount {
        self.auth_info.fee.amount
    }
    
    /// Get gas limit
    pub fn gas_limit(&self) -> u64 {
        self.auth_info.fee.gas_limit
    }
    
    /// Get sender addresses
    pub fn senders(&self) -> Vec<Address> {
        self.auth_info.signer_infos.iter()
            .map(|info| info.public_key.address())
            .collect()
    }
}

/// Raw transaction for signing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxRaw {
    pub body_bytes: Vec<u8>,
    pub auth_info_bytes: Vec<u8>,
}

/// Transaction body
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxBody {
    /// List of messages to execute
    pub messages: Vec<Message>,
    /// Optional memo
    pub memo: String,
    /// Timeout height
    pub timeout_height: Option<u64>,
    /// Extension options
    pub extension_options: Vec<Any>,
    /// Non-critical extension options
    pub non_critical_extension_options: Vec<Any>,
}

impl TxBody {
    pub fn new(messages: Vec<Message>) -> Self {
        Self {
            messages,
            memo: String::new(),
            timeout_height: None,
            extension_options: vec![],
            non_critical_extension_options: vec![],
        }
    }
    
    pub fn with_memo(mut self, memo: impl Into<String>) -> Self {
        self.memo = memo.into();
        self
    }
    
    pub fn with_timeout(mut self, height: u64) -> Self {
        self.timeout_height = Some(height);
        self
    }
}

/// Auth info (signers and fees)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthInfo {
    pub signer_infos: Vec<SignerInfo>,
    pub fee: Fee,
}

impl AuthInfo {
    pub fn new(signer_infos: Vec<SignerInfo>, fee: Fee) -> Self {
        Self { signer_infos, fee }
    }
    
    pub fn with_single_signer(public_key: super::crypto::PublicKey, sequence: u64, fee: Fee) -> Self {
        Self {
            signer_infos: vec![SignerInfo {
                public_key,
                mode_info: ModeInfo::Single(Single {
                    mode: SignMode::Direct,
                }),
                sequence,
            }],
            fee,
        }
    }
}

/// Signer info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerInfo {
    pub public_key: super::crypto::PublicKey,
    pub mode_info: ModeInfo,
    pub sequence: u64,
}

/// Mode info for signing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModeInfo {
    Single(Single),
    Multi(Multi),
}

/// Single signature mode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Single {
    pub mode: SignMode,
}

/// Multi-signature mode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Multi {
    pub bitarray: CompactBitArray,
    pub mode_infos: Vec<ModeInfo>,
}

/// Compact bit array for multi-sig
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactBitArray {
    pub extra_bits_stored: u32,
    pub elems: Vec<u8>,
}

/// Sign mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum SignMode {
    Unspecified = 0,
    Direct = 1,
    Textual = 2,
    LegacyAminoJson = 127,
    EIP191 = 191,
}

/// Fee structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fee {
    pub amount: Amount,
    pub gas_limit: u64,
    pub payer: Option<Address>,
    pub granter: Option<Address>,
}

impl Fee {
    pub fn new(amount: Amount, gas_limit: u64) -> Self {
        Self {
            amount,
            gas_limit,
            payer: None,
            granter: None,
        }
    }
}

/// Generic protobuf any type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Any {
    pub type_url: String,
    pub value: Vec<u8>,
}

/// Transaction status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum TxStatus {
    Pending = 0,
    Success = 1,
    Failed = 2,
}

/// Event emitted during transaction execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_type: String,
    pub attributes: Vec<EventAttribute>,
}

/// Event attribute
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventAttribute {
    pub key: String,
    pub value: String,
    pub index: bool,
}

/// Message types for the Aethelred blockchain
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "@type", content = "value")]
pub enum Message {
    // Bank module
    #[serde(rename = "/aethelred.bank.MsgSend")]
    Send(MsgSend),
    #[serde(rename = "/aethelred.bank.MsgMultiSend")]
    MultiSend(MsgMultiSend),
    
    // Staking module
    #[serde(rename = "/aethelred.staking.MsgCreateValidator")]
    CreateValidator(MsgCreateValidator),
    #[serde(rename = "/aethelred.staking.MsgEditValidator")]
    EditValidator(MsgEditValidator),
    #[serde(rename = "/aethelred.staking.MsgDelegate")]
    Delegate(MsgDelegate),
    #[serde(rename = "/aethelred.staking.MsgUndelegate")]
    Undelegate(MsgUndelegate),
    #[serde(rename = "/aethelred.staking.MsgBeginRedelegate")]
    BeginRedelegate(MsgBeginRedelegate),
    
    // Distribution module
    #[serde(rename = "/aethelred.distribution.MsgWithdrawDelegatorReward")]
    WithdrawDelegatorReward(MsgWithdrawDelegatorReward),
    #[serde(rename = "/aethelred.distribution.MsgSetWithdrawAddress")]
    SetWithdrawAddress(MsgSetWithdrawAddress),
    #[serde(rename = "/aethelred.distribution.MsgWithdrawValidatorCommission")]
    WithdrawValidatorCommission(MsgWithdrawValidatorCommission),
    #[serde(rename = "/aethelred.distribution.MsgFundCommunityPool")]
    FundCommunityPool(MsgFundCommunityPool),
    
    // Governance module
    #[serde(rename = "/aethelred.gov.MsgSubmitProposal")]
    SubmitProposal(MsgSubmitProposal),
    #[serde(rename = "/aethelred.gov.MsgVote")]
    Vote(MsgVote),
    #[serde(rename = "/aethelred.gov.MsgVoteWeighted")]
    VoteWeighted(MsgVoteWeighted),
    #[serde(rename = "/aethelred.gov.MsgDeposit")]
    Deposit(MsgDeposit),
    
    // AI Job module
    #[serde(rename = "/aethelred.ai.MsgSubmitJob")]
    SubmitJob(MsgSubmitJob),
    #[serde(rename = "/aethelred.ai.MsgVerifyJob")]
    VerifyJob(MsgVerifyJob),
    #[serde(rename = "/aethelred.ai.MsgClaimJobReward")]
    ClaimJobReward(MsgClaimJobReward),
    
    // Seal module
    #[serde(rename = "/aethelred.seal.MsgCreateSeal")]
    CreateSeal(MsgCreateSeal),
    #[serde(rename = "/aethelred.seal.MsgRevokeSeal")]
    RevokeSeal(MsgRevokeSeal),
    #[serde(rename = "/aethelred.seal.MsgVerifySeal")]
    VerifySeal(MsgVerifySeal),
    
    // Model module
    #[serde(rename = "/aethelred.model.MsgRegisterModel")]
    RegisterModel(MsgRegisterModel),
    #[serde(rename = "/aethelred.model.MsgUpdateModel")]
    UpdateModel(MsgUpdateModel),
    #[serde(rename = "/aethelred.model.MsgDeregisterModel")]
    DeregisterModel(MsgDeregisterModel),
    
    // Vault module (Liquid Staking)
    #[serde(rename = "/aethelred.vault.MsgStake")]
    VaultStake(MsgVaultStake),
    #[serde(rename = "/aethelred.vault.MsgUnstake")]
    VaultUnstake(MsgVaultUnstake),
    #[serde(rename = "/aethelred.vault.MsgClaimRewards")]
    VaultClaimRewards(MsgVaultClaimRewards),
    #[serde(rename = "/aethelred.vault.MsgWithdrawUnstaked")]
    VaultWithdrawUnstaked(MsgVaultWithdrawUnstaked),
    
    // WASM module
    #[serde(rename = "/aethelred.wasm.MsgStoreCode")]
    StoreCode(MsgStoreCode),
    #[serde(rename = "/aethelred.wasm.MsgInstantiateContract")]
    InstantiateContract(MsgInstantiateContract),
    #[serde(rename = "/aethelred.wasm.MsgExecuteContract")]
    ExecuteContract(MsgExecuteContract),
    #[serde(rename = "/aethelred.wasm.MsgMigrateContract")]
    MigrateContract(MsgMigrateContract),
}

// ============== BANK MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgSend {
    pub from_address: Address,
    pub to_address: Address,
    pub amount: Vec<Coin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgMultiSend {
    pub inputs: Vec<Input>,
    pub outputs: Vec<Output>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Input {
    pub address: Address,
    pub coins: Vec<Coin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Output {
    pub address: Address,
    pub coins: Vec<Coin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Coin {
    pub denom: String,
    pub amount: Amount,
}

// ============== STAKING MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgCreateValidator {
    pub description: Description,
    pub commission: CommissionRates,
    pub min_self_delegation: Amount,
    pub delegator_address: Address,
    pub validator_address: Address,
    pub pubkey: Option<Any>,
    pub value: Coin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgEditValidator {
    pub description: Description,
    pub validator_address: Address,
    pub commission_rate: Option<String>,
    pub min_self_delegation: Option<Amount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgDelegate {
    pub delegator_address: Address,
    pub validator_address: Address,
    pub amount: Coin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgUndelegate {
    pub delegator_address: Address,
    pub validator_address: Address,
    pub amount: Coin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgBeginRedelegate {
    pub delegator_address: Address,
    pub validator_src_address: Address,
    pub validator_dst_address: Address,
    pub amount: Coin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Description {
    pub moniker: String,
    pub identity: String,
    pub website: String,
    pub security_contact: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommissionRates {
    pub rate: String,
    pub max_rate: String,
    pub max_change_rate: String,
}

// ============== DISTRIBUTION MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgWithdrawDelegatorReward {
    pub delegator_address: Address,
    pub validator_address: Address,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgSetWithdrawAddress {
    pub delegator_address: Address,
    pub withdraw_address: Address,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgWithdrawValidatorCommission {
    pub validator_address: Address,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgFundCommunityPool {
    pub amount: Vec<Coin>,
    pub depositor: Address,
}

// ============== GOVERNANCE MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgSubmitProposal {
    pub content: Option<Any>,
    pub initial_deposit: Vec<Coin>,
    pub proposer: Address,
    pub title: String,
    pub summary: String,
    pub expedited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgVote {
    pub proposal_id: u64,
    pub voter: Address,
    pub option: VoteOption,
    pub metadata: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgVoteWeighted {
    pub proposal_id: u64,
    pub voter: Address,
    pub options: Vec<WeightedVoteOption>,
    pub metadata: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightedVoteOption {
    pub option: VoteOption,
    pub weight: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum VoteOption {
    Unspecified = 0,
    Yes = 1,
    Abstain = 2,
    No = 3,
    NoWithVeto = 4,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgDeposit {
    pub proposal_id: u64,
    pub depositor: Address,
    pub amount: Vec<Coin>,
}

// ============== AI JOB MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgSubmitJob {
    pub creator: Address,
    pub model_hash: Hash,
    pub input_hash: Hash,
    pub proof_type: ProofType,
    pub priority: u32,
    pub max_cost: Amount,
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgVerifyJob {
    pub validator: Address,
    pub job_id: Hash,
    pub output_hash: Hash,
    pub tee_attestation: Vec<u8>,
    pub verification_proof: Vec<u8>,
    pub cpu_cycles: u64,
    pub memory_used: u64,
    pub compute_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgClaimJobReward {
    pub validator: Address,
    pub job_id: Hash,
}

// ============== SEAL MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgCreateSeal {
    pub creator: Address,
    pub job_id: Hash,
    pub model_commitment: Hash,
    pub input_commitment: Hash,
    pub output_commitment: Hash,
    pub validator_addresses: Vec<Address>,
    pub expiration: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgRevokeSeal {
    pub creator: Address,
    pub seal_id: Hash,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgVerifySeal {
    pub verifier: Address,
    pub seal_id: Hash,
    pub verification_data: Vec<u8>,
}

// ============== MODEL MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgRegisterModel {
    pub owner: Address,
    pub name: String,
    pub model_hash: Hash,
    pub architecture: String,
    pub version: String,
    pub category: ModelCategory,
    pub input_schema: String,
    pub output_schema: String,
    pub storage_uri: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum ModelCategory {
    General = 0,
    Medical = 1,
    Scientific = 2,
    Financial = 3,
    Legal = 4,
    Educational = 5,
    Environmental = 6,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgUpdateModel {
    pub owner: Address,
    pub model_hash: Hash,
    pub name: Option<String>,
    pub storage_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgDeregisterModel {
    pub owner: Address,
    pub model_hash: Hash,
}

// ============== VAULT MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgVaultStake {
    pub delegator: Address,
    pub amount: Coin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgVaultUnstake {
    pub delegator: Address,
    pub share_amount: Amount,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgVaultClaimRewards {
    pub delegator: Address,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgVaultWithdrawUnstaked {
    pub delegator: Address,
    pub request_id: u64,
}

// ============== WASM MESSAGES ==============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgStoreCode {
    pub sender: Address,
    pub wasm_byte_code: Vec<u8>,
    pub instantiate_permission: Option<AccessConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgInstantiateContract {
    pub sender: Address,
    pub admin: Option<Address>,
    pub code_id: u64,
    pub label: String,
    pub msg: Vec<u8>,
    pub funds: Vec<Coin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgExecuteContract {
    pub sender: Address,
    pub contract: Address,
    pub msg: Vec<u8>,
    pub funds: Vec<Coin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgMigrateContract {
    pub sender: Address,
    pub contract: Address,
    pub code_id: u64,
    pub msg: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessConfig {
    pub permission: AccessType,
    pub addresses: Vec<Address>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum AccessType {
    Unspecified = 0,
    Nobody = 1,
    OnlyAddress = 2,
    Everybody = 3,
}
