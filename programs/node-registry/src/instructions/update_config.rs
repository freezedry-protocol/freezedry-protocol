use anchor_lang::prelude::*;
use crate::state::RegistryConfig;
use crate::error::RegistryError;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"fd-registry-config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ RegistryError::NotAuthority,
    )]
    pub config: Account<'info, RegistryConfig>,

    pub authority: Signer<'info>,
}

pub fn update_config(
    ctx: Context<UpdateConfig>,
    preferred_validator: Option<Pubkey>,
    new_authority: Option<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(validator) = preferred_validator {
        config.preferred_validator = validator;
    }

    if let Some(authority) = new_authority {
        config.authority = authority;
    }

    Ok(())
}
