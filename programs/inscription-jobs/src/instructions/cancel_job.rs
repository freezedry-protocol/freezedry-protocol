use anchor_lang::prelude::*;
use crate::state::{JobAccount, JobStatus};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct CancelJob<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = job.status == JobStatus::Open @ JobsError::InvalidJobStatus,
        constraint = job.creator == creator.key() @ JobsError::NotCreator,
    )]
    pub job: Account<'info, JobAccount>,

    /// Creator receives escrow + rent refund
    #[account(mut)]
    pub creator: Signer<'info>,
}

/// Creator cancels an unclaimed (Open) job. Full refund via PDA close.
pub fn cancel_job(_ctx: Context<CancelJob>) -> Result<()> {
    // close = creator in constraints handles:
    // - Transferring all lamports (escrow + rent) back to creator
    // - Zeroing the account data
    // - Assigning account to system program
    Ok(())
}
