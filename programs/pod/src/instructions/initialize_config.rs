use anchor_lang::prelude::*;
use crate::state::PodConfig;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PodConfig::INIT_SPACE,
        seeds = [b"fd-pod-config"],
        bump,
    )]
    pub config: Account<'info, PodConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_config(
    ctx: Context<InitializeConfig>,
    cdn_pubkey: [u8; 32],
    epoch_length: u32,
    max_receipt_age: u32,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.cdn_pubkey = cdn_pubkey;
    config.epoch_length = epoch_length;
    config.max_receipt_age = max_receipt_age;
    config.total_receipts = 0;
    config.bump = ctx.bumps.config;
    config._reserved = [0u8; 47];
    Ok(())
}
