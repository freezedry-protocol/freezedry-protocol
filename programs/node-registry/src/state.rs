use anchor_lang::prelude::*;

/// Role a community node serves in the Freeze Dry network.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum NodeRole {
    Reader,
    Writer,
    Both,
}

/// On-chain account for a registered Freeze Dry community node.
/// PDA seeds: ["freeze-node", owner_pubkey]
#[account]
#[derive(InitSpace)]
pub struct NodeAccount {
    /// Node operator wallet (signer for all mutations)
    pub wallet: Pubkey,

    /// Human-readable node identifier, e.g. "gcp-east"
    #[max_len(32)]
    pub node_id: String,

    /// Public URL of the node, must be HTTPS
    #[max_len(128)]
    pub url: String,

    /// Reader, Writer, or Both
    pub role: NodeRole,

    /// Unix timestamp when registered
    pub registered_at: i64,

    /// Unix timestamp of last heartbeat
    pub last_heartbeat: i64,

    /// Whether the node is currently active
    pub is_active: bool,

    /// Number of artworks this node has indexed
    pub artworks_indexed: u64,

    /// Number of artworks fully available on this node
    pub artworks_complete: u64,

    /// PDA bump seed
    pub bump: u8,

    // ── Stake verification fields (v2) ───────────────────────────────────
    // Replaces old _reserved: [u8; 64]. Same total size (8+32+8+16 = 64).
    // Existing PDAs have zeros here → verified_stake = 0 = "unverified".

    /// Verified delegation lamports from a native Stake Account (0 = unverified)
    pub verified_stake: u64,

    /// Validator vote account the stake is delegated to
    pub stake_voter: Pubkey,

    /// Unix timestamp when stake was last verified on-chain
    pub stake_verified_at: i64,

    /// Reserved for future expansion
    pub _reserved2: [u8; 16],
}

/// Global registry configuration — stores preferred validator and admin authority.
/// PDA seeds: ["fd-registry-config"]
#[account]
#[derive(InitSpace)]
pub struct RegistryConfig {
    /// Authority that can update this config (deployer wallet)
    pub authority: Pubkey,

    /// Preferred validator vote account — nodes staked here get Tier 1 priority
    pub preferred_validator: Pubkey,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved for future expansion
    pub _reserved: [u8; 64],
}
