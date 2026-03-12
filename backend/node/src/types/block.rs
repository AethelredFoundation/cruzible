//! Block types for Aethelred blockchain

use super::{Hash, Timestamp, Address, Amount, AethelredError};
use serde::{Deserialize, Serialize};

/// Block header containing metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockHeader {
    /// Block number (height)
    pub height: u64,
    /// Block hash
    pub hash: Hash,
    /// Previous block hash
    pub parent_hash: Hash,
    /// Timestamp when block was created
    pub timestamp: Timestamp,
    /// Block producer (validator) address
    pub proposer: Address,
    /// State root after executing this block
    pub state_root: Hash,
    /// Transactions root (Merkle root of tx hashes)
    pub tx_root: Hash,
    /// Evidence root (for slashing)
    pub evidence_root: Hash,
    /// Validator set hash
    pub validators_hash: Hash,
    /// Next validator set hash
    pub next_validators_hash: Hash,
    /// Consensus parameters hash
    pub consensus_hash: Hash,
    /// App state hash
    pub app_hash: Hash,
    /// Last results hash
    pub last_results_hash: Hash,
    /// Number of transactions
    pub num_txs: u32,
    /// Total gas used
    pub gas_used: u64,
    /// Gas limit
    pub gas_limit: u64,
    /// Block version
    pub version: BlockVersion,
    /// Chain ID
    pub chain_id: String,
    /// Epoch number
    pub epoch: u64,
    /// Randomness beacon (VRF output)
    pub randomness: Hash,
    /// Evidence of misbehavior
    pub evidence: Vec<Evidence>,
    /// Signatures
    pub signatures: Vec<CommitSignature>,
}

impl BlockHeader {
    pub fn hash(&self) -> Hash {
        let data = bincode::serialize(self)
            .expect("BlockHeader serialization should not fail");
        Hash::new(&data)
    }
}

/// Block version information
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BlockVersion {
    pub block: u64,
    pub app: u64,
}

impl Default for BlockVersion {
    fn default() -> Self {
        Self {
            block: 11, // Tendermint block version
            app: 1,
        }
    }
}

/// Full block including header and transactions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub header: BlockHeader,
    pub transactions: Vec<Transaction>,
}

impl Block {
    /// Create a new block
    pub fn new(
        height: u64,
        parent_hash: Hash,
        proposer: Address,
        transactions: Vec<Transaction>,
        chain_id: String,
        epoch: u64,
    ) -> Self {
        let timestamp = Timestamp::now();
        let tx_root = Self::compute_tx_root(&transactions);
        let num_txs = transactions.len() as u32;
        
        let header = BlockHeader {
            height,
            hash: Hash::ZERO, // Computed later
            parent_hash,
            timestamp,
            proposer,
            state_root: Hash::ZERO, // Set after execution
            tx_root,
            evidence_root: Hash::ZERO,
            validators_hash: Hash::ZERO,
            next_validators_hash: Hash::ZERO,
            consensus_hash: Hash::ZERO,
            app_hash: Hash::ZERO,
            last_results_hash: Hash::ZERO,
            num_txs,
            gas_used: 0, // Computed during execution
            gas_limit: 30_000_000,
            version: BlockVersion::default(),
            chain_id,
            epoch,
            randomness: Hash::ZERO,
            evidence: vec![],
            signatures: vec![],
        };
        
        let mut block = Self {
            header,
            transactions,
        };
        
        // Compute block hash
        block.header.hash = block.compute_hash();
        
        block
    }
    
    /// Compute the Merkle root of transactions
    fn compute_tx_root(transactions: &[Transaction]) -> Hash {
        if transactions.is_empty() {
            return Hash::ZERO;
        }
        
        let leaves: Vec<_> = transactions.iter()
            .map(|tx| tx.hash().as_bytes().to_vec())
            .collect();
        
        compute_merkle_root(&leaves)
    }
    
    /// Compute block hash
    pub fn compute_hash(&self) -> Hash {
        let mut header = self.header.clone();
        header.hash = Hash::ZERO;
        header.state_root = Hash::ZERO;
        header.app_hash = Hash::ZERO;
        header.signatures.clear();
        
        let data = bincode::serialize(&header)
            .expect("BlockHeader serialization should not fail");
        Hash::new(&data)
    }
    
    /// Validate basic block properties
    pub fn validate_basic(&self) -> Result<(), AethelredError> {
        // Check block size
        let block_size = bincode::serialized_size(self)
            .map_err(|e| AethelredError::BlockError(format!("Serialization failed: {}", e)))?;
        
        if block_size > crate::types::MAX_BLOCK_SIZE as u64 {
            return Err(AethelredError::BlockError(
                format!("Block too large: {} > {}", block_size, crate::types::MAX_BLOCK_SIZE)
            ));
        }
        
        // Check transaction count
        if self.transactions.len() > crate::types::MAX_TXS_PER_BLOCK {
            return Err(AethelredError::BlockError(
                format!("Too many transactions: {} > {}", 
                    self.transactions.len(), crate::types::MAX_TXS_PER_BLOCK)
            ));
        }
        
        // Verify block hash
        let computed_hash = self.compute_hash();
        if computed_hash != self.header.hash {
            return Err(AethelredError::BlockError(
                "Block hash mismatch".to_string()
            ));
        }
        
        // Verify transaction root
        let computed_tx_root = Self::compute_tx_root(&self.transactions);
        if computed_tx_root != self.header.tx_root {
            return Err(AethelredError::BlockError(
                "Transaction root mismatch".to_string()
            ));
        }
        
        Ok(())
    }
    
    /// Get total gas used by transactions
    pub fn total_gas_used(&self) -> u64 {
        self.transactions.iter().map(|tx| tx.gas_used).sum()
    }
    
    /// Get total fees
    pub fn total_fees(&self) -> Amount {
        self.transactions.iter()
            .map(|tx| tx.fee)
            .fold(Amount::from_raw(0), |acc, fee| acc.checked_add(fee).unwrap_or(acc))
    }
}

/// Block commit signature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitSignature {
    pub block_id_flag: BlockIdFlag,
    pub validator_address: Address,
    pub timestamp: Timestamp,
    pub signature: Vec<u8>,
}

/// Block ID flag for commit signatures
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum BlockIdFlag {
    Unknown = 0,
    Absent = 1,
    Commit = 2,
    Nil = 3,
}

/// Evidence of validator misbehavior
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Evidence {
    /// Double signing evidence
    DuplicateVote(DuplicateVoteEvidence),
    /// Light client attack
    LightClientAttack(LightClientAttackEvidence),
}

/// Double voting evidence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateVoteEvidence {
    pub vote_a: Vote,
    pub vote_b: Vote,
    pub total_voting_power: i64,
    pub validator_power: i64,
    pub timestamp: Timestamp,
}

/// Light client attack evidence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightClientAttackEvidence {
    pub conflicting_block: LightBlock,
    pub common_height: i64,
    pub byzantine_validators: Vec<ValidatorInfo>,
    pub total_voting_power: i64,
    pub timestamp: Timestamp,
}

/// Light block for evidence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightBlock {
    pub signed_header: SignedHeader,
    pub validator_set: ValidatorSet,
}

/// Signed header
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedHeader {
    pub header: BlockHeader,
    pub commit: Commit,
}

/// Commit for a block
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commit {
    pub height: u64,
    pub round: i32,
    pub block_id: BlockId,
    pub signatures: Vec<CommitSignature>,
}

/// Block identifier
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockId {
    pub hash: Hash,
    pub part_set_header: PartSetHeader,
}

/// Part set header for block propagation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartSetHeader {
    pub total: u32,
    pub hash: Hash,
}

/// Validator set
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorSet {
    pub validators: Vec<ValidatorInfo>,
    pub proposer: ValidatorInfo,
    pub total_voting_power: i64,
}

/// Validator info (minimal for consensus)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorInfo {
    pub address: Address,
    pub pub_key: PublicKey,
    pub voting_power: i64,
    pub proposer_priority: i64,
}

/// Vote for consensus
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vote {
    pub vote_type: VoteType,
    pub height: i64,
    pub round: i32,
    pub block_id: Option<BlockId>,
    pub timestamp: Timestamp,
    pub validator_address: Address,
    pub validator_index: i32,
    pub signature: Vec<u8>,
}

/// Vote type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum VoteType {
    Unknown = 0,
    Prevote = 1,
    Precommit = 2,
}

/// Public key types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PublicKey {
    Ed25519([u8; 32]),
    Secp256k1([u8; 33]),
}

impl PublicKey {
    pub fn address(&self) -> Address {
        let hash = match self {
            PublicKey::Ed25519(pk) => Hash::new(pk),
            PublicKey::Secp256k1(pk) => Hash::new(pk),
        };
        // Take first 20 bytes for address
        let addr_bytes = &hash.as_bytes()[..20];
        Address::new("aeth", addr_bytes).expect("Valid address construction")
    }
}

/// Compute Merkle root of a list of byte arrays
fn compute_merkle_root(leaves: &[Vec<u8>]) -> Hash {
    if leaves.is_empty() {
        return Hash::ZERO;
    }
    
    if leaves.len() == 1 {
        return Hash::new(&leaves[0]);
    }
    
    let mut current_level: Vec<_> = leaves.iter()
        .map(|leaf| Hash::new(leaf).as_bytes().to_vec())
        .collect();
    
    while current_level.len() > 1 {
        let mut next_level = Vec::new();
        
        for chunk in current_level.chunks(2) {
            let combined = if chunk.len() == 2 {
                let mut bytes = chunk[0].clone();
                bytes.extend_from_slice(&chunk[1]);
                Hash::new(&bytes).as_bytes().to_vec()
            } else {
                chunk[0].clone()
            };
            next_level.push(combined);
        }
        
        current_level = next_level;
    }
    
    let mut result = [0u8; 32];
    result.copy_from_slice(&current_level[0]);
    Hash::from_bytes(result)
}

use super::transaction::Transaction;
use super::validator::ValidatorInfo as FullValidatorInfo;
