use anchor_lang::prelude::*;
use crate::state::{Config, JobAccount, JobStatus};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct RequeueExpired<'info> {
    #[account(
        mut,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = job.status == JobStatus::Claimed @ JobsError::InvalidJobStatus,
    )]
    pub job: Account<'info, JobAccount>,

    #[account(
        seeds = [b"fd-config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// Anyone can trigger requeue of a stale claimed job (permissionless)
    pub signer: Signer<'info>,
}

/// Requeue a claimed job whose writer failed to complete in time.
/// Permissionless — anyone can call once the claim timeout has passed.
/// Resets status to Open so another writer can pick it up.
/// Claim timeout = job_expiry_seconds / 2 (half the total expiry window).
pub fn requeue_expired(ctx: Context<RequeueExpired>) -> Result<()> {
    let job = &mut ctx.accounts.job;
    let config = &ctx.accounts.config;

    // Claim timeout: half the total expiry window
    // If job_expiry_seconds = 7200 (2h), claim timeout = 3600 (1h)
    let claim_timeout = config.job_expiry_seconds / 2;

    let now = Clock::get()?.unix_timestamp;
    let elapsed_since_claim = now
        .checked_sub(job.claimed_at)
        .ok_or(error!(JobsError::Overflow))?;

    require!(
        elapsed_since_claim > claim_timeout,
        JobsError::NotExpired
    );

    // Reset to Open — clear assignment so any writer can claim
    job.status = JobStatus::Open;
    job.writer = Pubkey::default();
    job.claimed_at = 0;
    job.assigned_node = Pubkey::default();
    job.exclusive_until = 0;

    Ok(())
}
