use anchor_lang::prelude::*;
use crate::state::ReferrerAccount;

#[derive(Accounts)]
pub struct CloseReferrer<'info> {
    #[account(
        mut,
        close = owner,
        seeds = [b"fd-referrer", owner.key().as_ref()],
        bump = referrer_account.bump,
        constraint = referrer_account.wallet == owner.key(),
    )]
    pub referrer_account: Account<'info, ReferrerAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn close_referrer(_ctx: Context<CloseReferrer>) -> Result<()> {
    Ok(())
}
