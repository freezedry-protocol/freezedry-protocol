use anchor_lang::prelude::*;

/// Global POD configuration — stores CDN Ed25519 public key, authority, epoch params.
/// PDA seeds: ["fd-pod-config"]
#[account]
#[derive(InitSpace)]
pub struct PodConfig {
    /// Authority that can update this config (deployer wallet)
    pub authority: Pubkey,

    /// Ed25519 public key of the CDN signer (32 raw bytes)
    pub cdn_pubkey: [u8; 32],

    /// Epoch duration in seconds (default 3600 = 1 hour)
    pub epoch_length: u32,

    /// Max age in seconds before a receipt is rejected (default 3600)
    pub max_receipt_age: u32,

    /// Global receipt counter
    pub total_receipts: u64,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved for future expansion
    pub _reserved: [u8; 47],
}

/// Per-node per-epoch aggregated delivery stats.
/// PDA seeds: ["fd-pod-node-epoch", epoch_u32_le, node_wallet]
/// Created via init_if_needed when first receipt for a node+epoch arrives.
#[account]
#[derive(InitSpace)]
pub struct NodeEpochAccount {
    /// Epoch number
    pub epoch: u32,

    /// Node wallet identity
    pub node_wallet: Pubkey,

    /// Number of deliveries in this epoch
    pub delivery_count: u64,

    /// Total bytes served in this epoch
    pub bytes_total: u64,

    /// Count of distinct content hashes served
    pub unique_hashes: u32,

    /// Earliest receipt timestamp in this epoch
    pub first_receipt_at: i64,

    /// Latest receipt timestamp in this epoch
    pub last_receipt_at: i64,

    /// Highest nonce submitted (replay protection: require nonce > last_nonce)
    pub last_nonce: u64,

    /// Locked after epoch finalization (no more receipts accepted)
    pub finalized: bool,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved for future expansion
    pub _reserved: [u8; 24],
}
