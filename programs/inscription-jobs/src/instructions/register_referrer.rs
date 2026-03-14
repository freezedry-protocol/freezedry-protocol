use anchor_lang::prelude::*;
use crate::state::ReferrerAccount;
use crate::error::JobsError;

#[derive(Accounts)]
pub struct RegisterReferrer<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + ReferrerAccount::INIT_SPACE,
        seeds = [b"fd-referrer", owner.key().as_ref()],
        bump,
    )]
    pub referrer_account: Account<'info, ReferrerAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_referrer(
    ctx: Context<RegisterReferrer>,
    name: String,
) -> Result<()> {
    require!(
        !name.is_empty() && name.len() <= 64,
        JobsError::InvalidReferrerName
    );

    let now = Clock::get()?.unix_timestamp;
    let referrer = &mut ctx.accounts.referrer_account;
    referrer.wallet = ctx.accounts.owner.key();
    referrer.name = name;
    referrer.registered_at = now;
    referrer.bump = ctx.bumps.referrer_account;
    referrer._reserved = [0u8; 32];

    Ok(())
}
