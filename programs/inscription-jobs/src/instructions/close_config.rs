use anchor_lang::prelude::*;
use crate::state::Config;
use crate::error::JobsError;

#[derive(Accounts)]
pub struct CloseConfig<'info> {
    #[account(
        mut,
        seeds = [b"fd-config"],
        bump,
        constraint = config.authority == authority.key() @ JobsError::NotCreator,
        close = authority,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Authority closes the Config PDA — returns rent to authority.
/// Use this to reset a stale/corrupt Config, then re-initialize.
/// Requires all jobs to be completed — prevents bricking in-flight jobs.
pub fn close_config(ctx: Context<CloseConfig>) -> Result<()> {
    let config = &ctx.accounts.config;

    // Prevent closing while jobs are in-flight — would brick active escrows
    require!(
        config.total_jobs_created == config.total_jobs_completed,
        JobsError::ActiveJobsExist
    );

    msg!("Config PDA closed by authority");
    Ok(())
}
