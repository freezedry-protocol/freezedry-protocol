use anchor_lang::prelude::*;
use crate::state::{Config, JobAccount, JobStatus, VerificationAttestation};
use crate::error::JobsError;
use crate::instructions::claim_job::verify_node_account;

#[derive(Accounts)]
pub struct Attest<'info> {
    #[account(
        mut,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = job.status == JobStatus::Submitted @ JobsError::InvalidJobStatus,
        // Inscriber cannot attest their own work — attestation must come from a different node.
        // This ensures a separate party independently verified the inscription.
        // The attester earns the attester fee share (snap_indexer_bps) for their verification work.
        constraint = job.writer != reader.key() @ JobsError::SelfAttestation,
    )]
    pub job: Account<'info, JobAccount>,

    #[account(
        seeds = [b"fd-config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = reader,
        space = 8 + VerificationAttestation::INIT_SPACE,
        seeds = [
            b"fd-attest",
            job.job_id.to_le_bytes().as_ref(),
            reader.key().as_ref(),
        ],
        bump,
    )]
    pub attestation: Account<'info, VerificationAttestation>,

    /// CHECK: Reader's NodeAccount from the registry program.
    /// Manually verified: owner == registry_program, discriminator, wallet, role, is_active.
    pub node_account: AccountInfo<'info>,

    #[account(mut)]
    pub reader: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn attest(ctx: Context<Attest>, computed_hash: String) -> Result<()> {
    // Validate hash format: non-empty, max 71 chars
    require!(!computed_hash.is_empty() && computed_hash.len() <= 71, JobsError::InvalidHash);

    let registry_program = &ctx.accounts.config.registry_program;
    let reader_key = ctx.accounts.reader.key();
    let node_info = &ctx.accounts.node_account;

    // Verify the NodeAccount is valid, belongs to reader, and has Reader/Both role
    // Roles: 0=Reader, 2=Both (stake info not needed for attestation)
    let _stake_info = verify_node_account(node_info, &reader_key, &[0, 2], registry_program)?;

    // Derive is_valid by comparing reader's computed hash to job's content_hash
    let is_valid = computed_hash == ctx.accounts.job.content_hash;

    let now = Clock::get()?.unix_timestamp;

    // Initialize the attestation PDA
    let attestation = &mut ctx.accounts.attestation;
    attestation.job_id = ctx.accounts.job.job_id;
    attestation.reader = reader_key;
    attestation.computed_hash = computed_hash;
    attestation.is_valid = is_valid;
    attestation.attested_at = now;
    attestation.bump = ctx.bumps.attestation;

    let job = &mut ctx.accounts.job;

    if is_valid {
        // Count valid attestations toward quorum
        job.attestation_count = job
            .attestation_count
            .checked_add(1)
            .ok_or(error!(JobsError::Overflow))?;
    } else {
        // Failed attestation: inscription is bad — requeue job so a different node can retry.
        // Reset to Open, clear writer/claimed_at so the marketplace reopens.
        job.status = JobStatus::Open;
        job.writer = Pubkey::default();
        job.claimed_at = 0;
        job.submitted_at = 0;
        job.pointer_sig = String::new();
    }

    Ok(())
}
