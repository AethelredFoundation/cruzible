//! Aethelred Core Types
//! 
//! Fundamental data structures for the blockchain including blocks, transactions,
//! validators, AI jobs, and cryptographic primitives.

pub mod block;
pub mod transaction;
pub mod validator;
pub mod ai_job;
pub mod seal;
pub mod model;
pub mod governance;
pub mod staking;
pub mod crypto;
pub mod errors;

pub use block::*;
pub use transaction::*;
pub use validator::*;
pub use ai_job::*;
pub use seal::*;
pub use model::*;
pub use governance::*;
pub use staking::*;
pub use crypto::*;
pub use errors::*;

use serde::{Deserialize, Serialize};
use std::fmt;

/// Chain ID for Aethelred mainnet
pub const CHAIN_ID_MAINNET: &str = "aethelred-1";

/// Chain ID for testnet
pub const CHAIN_ID_TESTNET: &str = "aethelred-testnet-1";

/// Chain ID for devnet
pub const CHAIN_ID_DEVNET: &str = "aethelred-devnet-1";

/// Block time target (seconds)
pub const BLOCK_TIME_TARGET: u64 = 3;

/// Epoch duration (blocks)
pub const EPOCH_DURATION: u64 = 1000;

/// Maximum transactions per block
pub const MAX_TXS_PER_BLOCK: usize = 10000;

/// Maximum block size (bytes)
pub const MAX_BLOCK_SIZE: usize = 10 * 1024 * 1024; // 10MB

/// Address type for Aethelred (bech32 encoded)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Address(String);

impl Address {
    pub const PREFIX: &'static str = "aeth";
    
    pub fn new(hrp: &str, bytes: &[u8]) -> Result<Self, AethelredError> {
        let encoded = bech32::encode(hrp, bytes.to_base32(), bech32::Variant::Bech32)
            .map_err(|e| AethelredError::AddressError(format!("Bech32 encode failed: {}", e)))?;
        Ok(Self(encoded))
    }
    
    pub fn from_string(address: &str) -> Result<Self, AethelredError> {
        let (hrp, _data, variant) = bech32::decode(address)
            .map_err(|e| AethelredError::AddressError(format!("Invalid bech32: {}", e)))?;
        
        if !hrp.starts_with(Self::PREFIX) {
            return Err(AethelredError::AddressError(
                format!("Invalid prefix: expected '{}', got '{}'", Self::PREFIX, hrp)
            ));
        }
        
        if variant != bech32::Variant::Bech32 {
            return Err(AethelredError::AddressError("Expected Bech32 variant".to_string()));
        }
        
        Ok(Self(address.to_string()))
    }
    
    pub fn as_str(&self) -> &str {
        &self.0
    }
    
    pub fn to_bytes(&self) -> Result<Vec<u8>, AethelredError> {
        let (_, data, _) = bech32::decode(&self.0)
            .map_err(|e| AethelredError::AddressError(format!("Decode failed: {}", e)))?;
        Ok(Vec::from_base32(&data)
            .map_err(|e| AethelredError::AddressError(format!("Base32 decode failed: {}", e)))?)
    }
}

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Hash type (32 bytes)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Hash([u8; 32]);

impl Hash {
    pub const ZERO: Self = Self([0u8; 32]);
    
    pub fn new(data: &[u8]) -> Self {
        use sha3::{Digest, Sha3_256};
        let mut hasher = Sha3_256::new();
        hasher.update(data);
        Self(hasher.finalize().into())
    }
    
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
    
    pub fn from_hex(hex: &str) -> Result<Self, AethelredError> {
        let bytes = hex::decode(hex)
            .map_err(|e| AethelredError::HashError(format!("Hex decode failed: {}", e)))?;
        if bytes.len() != 32 {
            return Err(AethelredError::HashError("Invalid hash length".to_string()));
        }
        let mut array = [0u8; 32];
        array.copy_from_slice(&bytes);
        Ok(Self(array))
    }
}

impl fmt::Display for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

/// Amount type for token quantities
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Amount(u128);

impl Amount {
    pub const DECIMALS: u8 = 18;
    pub const SYMBOL: &'static str = "AETHEL";
    
    pub fn from_raw(value: u128) -> Self {
        Self(value)
    }
    
    pub fn from_human(value: f64) -> Self {
        let raw = (value * 10f64.powi(Self::DECIMALS as i32)) as u128;
        Self(raw)
    }
    
    pub fn raw(&self) -> u128 {
        self.0
    }
    
    pub fn human(&self) -> f64 {
        self.0 as f64 / 10f64.powi(Self::DECIMALS as i32)
    }
    
    pub fn checked_add(self, other: Self) -> Option<Self> {
        self.0.checked_add(other.0).map(Self)
    }
    
    pub fn checked_sub(self, other: Self) -> Option<Self> {
        self.0.checked_sub(other.0).map(Self)
    }
    
    pub fn checked_mul(self, other: Self) -> Option<Self> {
        self.0.checked_mul(other.0).map(Self)
    }
    
    pub fn checked_div(self, other: Self) -> Option<Self> {
        self.0.checked_div(other.0).map(Self)
    }
}

impl fmt::Display for Amount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:.6} {}", self.human(), Self::SYMBOL)
    }
}

/// Timestamp (nanoseconds since epoch)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Timestamp(u64);

impl Timestamp {
    pub fn now() -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_nanos() as u64;
        Self(nanos)
    }
    
    pub fn from_nanos(nanos: u64) -> Self {
        Self(nanos)
    }
    
    pub fn nanos(&self) -> u64 {
        self.0
    }
    
    pub fn seconds(&self) -> u64 {
        self.0 / 1_000_000_000
    }
    
    pub fn millis(&self) -> u64 {
        self.0 / 1_000_000
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use chrono::{DateTime, Utc};
        let datetime = DateTime::<Utc>::from_timestamp(
            (self.0 / 1_000_000_000) as i64,
            (self.0 % 1_000_000_000) as u32
        );
        match datetime {
            Some(dt) => write!(f, "{}", dt.format("%Y-%m-%d %H:%M:%S.%3f UTC")),
            None => write!(f, "Invalid timestamp"),
        }
    }
}

/// Gas and fee configuration
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GasConfig {
    /// Base gas price
    pub base_gas_price: Amount,
    /// Minimum gas price
    pub min_gas_price: Amount,
    /// Maximum gas per block
    pub max_gas_per_block: u64,
    /// Target gas per block
    pub target_gas_per_block: u64,
}

impl Default for GasConfig {
    fn default() -> Self {
        Self {
            base_gas_price: Amount::from_raw(1000000000), // 1 gwei
            min_gas_price: Amount::from_raw(100000000),   // 0.1 gwei
            max_gas_per_block: 30_000_000,
            target_gas_per_block: 15_000_000,
        }
    }
}

/// Network version
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Version {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
}

impl Version {
    pub const CURRENT: Self = Self {
        major: 1,
        minor: 0,
        patch: 0,
    };
    
    pub fn new(major: u16, minor: u16, patch: u16) -> Self {
        Self { major, minor, patch }
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Genesis configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenesisConfig {
    pub chain_id: String,
    pub genesis_time: Timestamp,
    pub initial_validators: Vec<ValidatorInfo>,
    pub initial_balances: Vec<(Address, Amount)>,
    pub params: ChainParams,
}

/// Chain parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainParams {
    pub max_validators: u32,
    pub min_validator_stake: Amount,
    pub unbonding_period: u64, // epochs
    pub max_evidence_age: u64, // blocks
    pub gas_config: GasConfig,
    pub inflation_rate: u64, // basis points per year
    pub community_tax: u64,  // basis points
    pub base_proposer_reward: u64, // basis points
    pub bonus_proposer_reward: u64, // basis points
}

impl Default for ChainParams {
    fn default() -> Self {
        Self {
            max_validators: 200,
            min_validator_stake: Amount::from_human(100000.0),
            unbonding_period: 21,
            max_evidence_age: 100000,
            gas_config: GasConfig::default(),
            inflation_rate: 700, // 7% annual
            community_tax: 200,  // 2%
            base_proposer_reward: 100, // 1%
            bonus_proposer_reward: 400, // 4%
        }
    }
}

/// Network statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkStats {
    pub block_height: u64,
    pub total_transactions: u64,
    pub total_accounts: u64,
    pub total_validators: u32,
    pub active_validators: u32,
    pub total_staked: Amount,
    pub inflation_rate: f64,
    pub community_pool: Amount,
}

/// Proof type for AI verification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum ProofType {
    /// TEE-based attestation (SGX/TDX)
    TeeAttestation = 0,
    /// Zero-knowledge proof
    ZkProof = 1,
    /// Multi-party computation proof
    MpcProof = 2,
    /// Optimistic with fraud proof
    Optimistic = 3,
}

impl fmt::Display for ProofType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProofType::TeeAttestation => write!(f, "TEE"),
            ProofType::ZkProof => write!(f, "ZK"),
            ProofType::MpcProof => write!(f, "MPC"),
            ProofType::Optimistic => write!(f, "Optimistic"),
        }
    }
}

/// Utility trait for base32 conversion
trait Base32Ext {
    fn to_base32(&self) -> Vec<bech32::u5>;
}

impl Base32Ext for [u8] {
    fn to_base32(&self) -> Vec<bech32::u5> {
        bech32::convert_bits(self, 8, 5, true)
            .unwrap_or_default()
            .into_iter()
            .map(bech32::u5::try_from)
            .filter_map(Result::ok)
            .collect()
    }
}

trait VecBase32Ext {
    fn from_base32(base32: &[bech32::u5]) -> Result<Vec<u8>, bech32::Error>;
}

impl VecBase32Ext for Vec<u8> {
    fn from_base32(base32: &[bech32::u5]) -> Result<Vec<u8>, bech32::Error> {
        let data: Vec<u8> = base32.iter().map(|b| b.to_u8()).collect();
        bech32::convert_bits(&data, 5, 8, false)
    }
}
