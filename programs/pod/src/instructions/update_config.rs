use anchor_lang::prelude::*;
use crate::state::PodConfig;
use crate::error::PodError;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"fd-pod-config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ PodError::NotAuthority,
    )]
    pub config: Account<'info, PodConfig>,

    pub authority: Signer<'info>,
}

pub fn update_config(
    ctx: Context<UpdateConfig>,
    cdn_pubkey: Option<[u8; 32]>,
    epoch_length: Option<u32>,
    max_receipt_age: Option<u32>,
    new_authority: Option<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(key) = cdn_pubkey {
        config.cdn_pubkey = key;
    }

    if let Some(len) = epoch_length {
        config.epoch_length = len;
    }

    if let Some(age) = max_receipt_age {
        config.max_receipt_age = age;
    }

    if let Some(auth) = new_authority {
        config.authority = auth;
    }

    Ok(())
}
