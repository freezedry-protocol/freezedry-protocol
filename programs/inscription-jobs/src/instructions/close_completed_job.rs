use anchor_lang::prelude::*;
use crate::state::{JobAccount, JobStatus};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct CloseCompletedJob<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = matches!(job.status, JobStatus::Completed | JobStatus::Expired | JobStatus::Cancelled)
            @ JobsError::InvalidJobStatus,
    )]
    pub job: Account<'info, JobAccount>,

    /// CHECK: Validated against job.creator — rent returns to original job creator
    #[account(
        mut,
        constraint = creator.key() == job.creator @ JobsError::NotCreator,
    )]
    pub creator: AccountInfo<'info>,

    /// Anyone can trigger close on completed jobs (permissionless, like release_payment)
    pub signer: Signer<'info>,
}

/// Permissionless close: any signer can close finished job PDAs.
/// Rent (~0.004 SOL) always returns to the original creator.
/// Works on Completed, Expired, or Cancelled jobs — escrow already distributed or refunded.
pub fn close_completed_job(_ctx: Context<CloseCompletedJob>) -> Result<()> {
    msg!("Completed job PDA closed — rent returned to creator");
    Ok(())
}
