use anchor_lang::prelude::*;

/// Job lifecycle status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum JobStatus {
    Open,       // 0 — waiting for writer to claim
    Claimed,    // 1 — writer claimed, inscription in progress
    Submitted,  // 2 — writer submitted completion proof
    Completed,  // 3 — quorum attestations received, payment released
    Cancelled,  // 4 — creator cancelled before claim
    Expired,    // 5 — timed out, refunded
    Disputed,   // 6 — future: attestation disagreement
}

/// Global config singleton — stores fee splits, quorum rules, counters.
/// PDA seeds: ["fd-config"]
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Admin authority (deployer initially, later multisig)
    pub authority: Pubkey,

    /// Treasury wallet — receives treasury + pool fee shares
    pub treasury: Pubkey,

    /// Registry program ID for NodeAccount verification
    pub registry_program: Pubkey,

    /// Inscriber (writer) share in basis points (2000 = 20%)
    pub inscriber_fee_bps: u16,

    /// Indexer pool share in basis points (2000 = 20%)
    pub indexer_fee_bps: u16,

    /// Treasury share in basis points (5000 = 50%)
    pub treasury_fee_bps: u16,

    /// Referral share in basis points (1000 = 10%)
    pub referral_fee_bps: u16,

    /// Minimum attestations for quorum (K in K-of-N)
    pub min_attestations: u8,

    /// Seconds before unclaimed/unfinished job can be refunded
    pub job_expiry_seconds: i64,

    /// Monotonic counter — next job gets this ID, then incremented
    pub total_jobs_created: u64,

    /// Count of completed jobs
    pub total_jobs_completed: u64,

    /// PDA bump seed
    pub bump: u8,

    /// Minimum escrow in lamports — enforced in create_job.
    /// Authority should update periodically to track ~$2 USD at current SOL price.
    /// Set to 0 to disable (legacy behavior).
    pub min_escrow_lamports: u64,

    /// Default exclusive window in seconds for assigned-node jobs (e.g. 1800 = 30 min)
    pub default_exclusive_window: u32,

    /// Maximum exclusive window in seconds — cap to prevent abuse (e.g. 3600 = 1 hr)
    pub max_exclusive_window: u32,

    /// Base TX fee per chunk in lamports (e.g. 5000). Used to compute tx_reimbursement at job creation.
    /// Set to 0 to disable TX layer (falls back to flat bps split).
    pub base_tx_fee_lamports: u64,

    /// Pending authority for two-step transfer (Pubkey::default() = no transfer pending)
    pub pending_authority: Pubkey,

    /// Reserved for future expansion (6 bytes remaining)
    pub _reserved: [u8; 6],
}

/// One inscription job with escrowed SOL.
/// PDA seeds: ["fd-job", job_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct JobAccount {
    /// Unique job ID from Config.total_jobs_created
    pub job_id: u64,

    /// User who created the job
    pub creator: Pubkey,

    /// Writer node who claimed (Pubkey::default() if unclaimed)
    pub writer: Pubkey,

    /// SHA-256 hash of the original file ("sha256:abcdef..." — up to 71 chars with prefix)
    #[max_len(71)]
    pub content_hash: String,

    /// Expected number of memo chunks
    pub chunk_count: u32,

    /// SOL locked in this PDA for the inscription fee
    pub escrow_lamports: u64,

    /// Current job lifecycle status
    pub status: JobStatus,

    /// Unix timestamp when job was created
    pub created_at: i64,

    /// Unix timestamp when writer claimed
    pub claimed_at: i64,

    /// Unix timestamp when writer submitted receipt
    pub submitted_at: i64,

    /// Unix timestamp when quorum reached + payment released
    pub completed_at: i64,

    /// How many readers have attested
    pub attestation_count: u8,

    /// Solana tx signature of the pointer memo
    #[max_len(128)]
    pub pointer_sig: String,

    /// PDA bump seed
    pub bump: u8,

    /// Referral wallet — earns referral_fee_bps share on release
    pub referrer: Pubkey,

    /// Assigned node — gets exclusive claim window. Pubkey::default() = open marketplace.
    pub assigned_node: Pubkey,

    /// Unix timestamp until which only assigned_node can claim. 0 = no exclusivity.
    pub exclusive_until: i64,

    /// URL where claimer should fetch the blob. Empty = use default CDN R2 staging.
    /// Max 200 chars. Allows implementors to specify IPFS, S3, own server, etc.
    #[max_len(200)]
    pub blob_source: String,

    /// TX cost reimbursement for the inscriber node (chunk_count × base_tx_fee_lamports).
    /// Paid first in release_payment, before margin split. 0 = flat bps split (backward compat).
    pub tx_reimbursement_lamports: u64,

    /// Fee BPS snapshot — locked at job creation time so authority can't change mid-flight
    pub snap_inscriber_bps: u16,
    pub snap_indexer_bps: u16,
    pub snap_treasury_bps: u16,
    pub snap_referral_bps: u16,
}

/// One reader's verification attestation for a job.
/// PDA seeds: ["fd-attest", job_id.to_le_bytes(), reader_wallet]
#[account]
#[derive(InitSpace)]
pub struct VerificationAttestation {
    /// Job this attestation is for
    pub job_id: u64,

    /// Reader who verified
    pub reader: Pubkey,

    /// Hash the reader computed from the blob (e.g. "sha256:abcdef...")
    #[max_len(71)]
    pub computed_hash: String,

    /// Derived by program: true if computed_hash == job.content_hash
    pub is_valid: bool,

    /// Unix timestamp of attestation
    pub attested_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

/// Registered referrer identity — earns referral_fee_bps share on release_payment.
/// PDA seeds: ["fd-referrer", wallet]
#[account]
#[derive(InitSpace)]
pub struct ReferrerAccount {
    /// The referrer's wallet (owner)
    pub wallet: Pubkey,

    /// Human-readable name (e.g. "Exchange Art")
    #[max_len(64)]
    pub name: String,

    /// Unix timestamp when registered
    pub registered_at: i64,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved for future expansion
    pub _reserved: [u8; 32],
}
