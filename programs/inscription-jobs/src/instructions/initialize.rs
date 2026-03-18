use anchor_lang::prelude::*;
use crate::state::Config;
use crate::error::JobsError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"fd-config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize(
    ctx: Context<Initialize>,
    treasury: Pubkey,
    registry_program: Pubkey,
    inscriber_fee_bps: u16,
    indexer_fee_bps: u16,
    treasury_fee_bps: u16,
    referral_fee_bps: u16,
    min_attestations: u8,
    job_expiry_seconds: i64,
    min_escrow_lamports: u64,
) -> Result<()> {
    // Fees must sum to exactly 10000 bps (100%)
    let total_bps = (inscriber_fee_bps as u32)
        .checked_add(indexer_fee_bps as u32)
        .and_then(|v| v.checked_add(treasury_fee_bps as u32))
        .and_then(|v| v.checked_add(referral_fee_bps as u32))
        .ok_or(error!(JobsError::Overflow))?;
    require!(total_bps == 10000, JobsError::InvalidFeeConfig);
    require!(min_attestations >= 1, JobsError::InvalidMinAttestations);
    require!(job_expiry_seconds > 0, JobsError::InvalidJobStatus);

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.treasury = treasury;
    config.registry_program = registry_program;
    config.inscriber_fee_bps = inscriber_fee_bps;
    config.indexer_fee_bps = indexer_fee_bps;
    config.treasury_fee_bps = treasury_fee_bps;
    config.referral_fee_bps = referral_fee_bps;
    config.min_attestations = min_attestations;
    config.job_expiry_seconds = job_expiry_seconds;
    config.total_jobs_created = 0;
    config.total_jobs_completed = 0;
    config.bump = ctx.bumps.config;
    config.min_escrow_lamports = min_escrow_lamports;
    config.default_exclusive_window = 1800; // 30 min default
    config.max_exclusive_window = 3600;     // 1 hr cap
    config.base_tx_fee_lamports = 0;         // Disabled by default — authority enables via update_config
    config.pending_authority = Pubkey::default();
    config._reserved = [0u8; 6];

    Ok(())
}
