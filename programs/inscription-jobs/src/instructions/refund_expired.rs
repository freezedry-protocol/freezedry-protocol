use anchor_lang::prelude::*;
use crate::state::{Config, JobAccount, JobStatus};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    #[account(
        mut,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
    )]
    pub job: Account<'info, JobAccount>,

    #[account(
        seeds = [b"fd-config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Validated against job.creator — receives escrow refund
    #[account(
        mut,
        constraint = creator.key() == job.creator @ JobsError::NotCreator,
    )]
    pub creator: AccountInfo<'info>,

    /// Anyone can trigger expired job refund (permissionless)
    pub signer: Signer<'info>,
}

/// Refund an expired job. Permissionless — anyone can call if expiry time passed.
/// Works for both Open (unclaimed) and Claimed (writer didn't finish) jobs.
/// Sets status to Expired and returns escrow to creator, but keeps PDA alive
/// so any outstanding attestation PDAs can still be closed via close_attestation.
pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
    let job = &ctx.accounts.job;
    let config = &ctx.accounts.config;

    // Only Open or Claimed jobs can be refunded as expired
    require!(
        job.status == JobStatus::Open || job.status == JobStatus::Claimed,
        JobsError::InvalidJobStatus
    );

    // Check if the job has actually expired
    let now = Clock::get()?.unix_timestamp;
    let elapsed = now
        .checked_sub(job.created_at)
        .ok_or(error!(JobsError::Overflow))?;
    require!(
        elapsed > config.job_expiry_seconds,
        JobsError::NotExpired
    );

    // Transfer escrow lamports back to creator (keep PDA alive for attestation cleanup)
    let escrow = job.escrow_lamports;
    if escrow > 0 {
        let job_info = ctx.accounts.job.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();
        **job_info.try_borrow_mut_lamports()? -= escrow;
        **creator_info.try_borrow_mut_lamports()? += escrow;
    }

    // Set status to Expired — PDA stays alive so attestation PDAs can be closed
    let job = &mut ctx.accounts.job;
    job.status = JobStatus::Expired;
    job.escrow_lamports = 0;

    Ok(())
}
