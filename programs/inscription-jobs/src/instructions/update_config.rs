use anchor_lang::prelude::*;
use crate::state::Config;
use crate::error::JobsError;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"fd-config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ JobsError::NotCreator,
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,
}

/// Authority updates Config parameters. All fields are optional —
/// pass None to leave unchanged.
pub fn update_config(
    ctx: Context<UpdateConfig>,
    treasury: Option<Pubkey>,
    inscriber_fee_bps: Option<u16>,
    indexer_fee_bps: Option<u16>,
    treasury_fee_bps: Option<u16>,
    referral_fee_bps: Option<u16>,
    min_attestations: Option<u8>,
    job_expiry_seconds: Option<i64>,
    min_escrow_lamports: Option<u64>,
    default_exclusive_window: Option<u32>,
    max_exclusive_window: Option<u32>,
    base_tx_fee_lamports: Option<u64>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    // Apply updates
    if let Some(t) = treasury {
        config.treasury = t;
    }
    if let Some(v) = inscriber_fee_bps {
        config.inscriber_fee_bps = v;
    }
    if let Some(v) = indexer_fee_bps {
        config.indexer_fee_bps = v;
    }
    if let Some(v) = treasury_fee_bps {
        config.treasury_fee_bps = v;
    }
    if let Some(v) = referral_fee_bps {
        config.referral_fee_bps = v;
    }
    if let Some(v) = min_attestations {
        require!(v >= 1, JobsError::InvalidMinAttestations);
        config.min_attestations = v;
    }
    if let Some(v) = job_expiry_seconds {
        require!(v > 0, JobsError::InvalidJobStatus);
        config.job_expiry_seconds = v;
    }
    if let Some(v) = min_escrow_lamports {
        config.min_escrow_lamports = v;
    }
    if let Some(v) = default_exclusive_window {
        config.default_exclusive_window = v;
    }
    if let Some(v) = max_exclusive_window {
        config.max_exclusive_window = v;
    }
    if let Some(v) = base_tx_fee_lamports {
        config.base_tx_fee_lamports = v;
    }

    // Validate fee totals if any fee was changed
    if inscriber_fee_bps.is_some() || indexer_fee_bps.is_some()
        || treasury_fee_bps.is_some() || referral_fee_bps.is_some()
    {
        let total = (config.inscriber_fee_bps as u32)
            .checked_add(config.indexer_fee_bps as u32)
            .and_then(|v| v.checked_add(config.treasury_fee_bps as u32))
            .and_then(|v| v.checked_add(config.referral_fee_bps as u32))
            .ok_or(error!(JobsError::Overflow))?;
        require!(total == 10000, JobsError::InvalidFeeConfig);
    }

    Ok(())
}
