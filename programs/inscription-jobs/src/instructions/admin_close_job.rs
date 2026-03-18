use anchor_lang::prelude::*;
use crate::state::{Config, JobAccount, JobStatus};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct AdminCloseJob<'info> {
    #[account(
        seeds = [b"fd-config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ JobsError::NotCreator,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        close = creator,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        // Block force-close on Submitted jobs (writer has done verifiable work)
        constraint = !matches!(job.status, JobStatus::Submitted)
            @ JobsError::InvalidJobStatus,
    )]
    pub job: Account<'info, JobAccount>,

    /// Authority must sign — only admin can force-close
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Validated against job.creator — escrow + rent always refunded to creator
    #[account(
        mut,
        constraint = creator.key() == job.creator @ JobsError::NotCreator,
    )]
    pub creator: AccountInfo<'info>,
}

/// Authority force-closes any Job PDA — for cleanup of stale/test jobs.
/// R1: Returns all lamports (escrow + rent) to the CREATOR, not authority.
pub fn admin_close_job(_ctx: Context<AdminCloseJob>) -> Result<()> {
    msg!("Job PDA force-closed by authority — escrow refunded to creator");
    Ok(())
}
