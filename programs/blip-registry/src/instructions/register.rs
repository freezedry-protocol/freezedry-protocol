use anchor_lang::prelude::*;
use crate::state::{UserAccount, UsernameAccount, is_valid_username};
use crate::error::BlipError;

#[derive(Accounts)]
#[instruction(username: String)]
pub struct Register<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [b"blip-user", owner.key().as_ref()],
        bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        init,
        payer = owner,
        space = 8 + UsernameAccount::INIT_SPACE,
        seeds = [b"blip-name", username.as_bytes()],
        bump,
    )]
    pub username_account: Account<'info, UsernameAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register(ctx: Context<Register>, username: String) -> Result<()> {
    require!(is_valid_username(&username), BlipError::InvalidUsername);

    let now = Clock::get()?.unix_timestamp;

    let user = &mut ctx.accounts.user_account;
    user.wallet = ctx.accounts.owner.key();
    user.username = username;
    user.registered_at = now;
    user.bump = ctx.bumps.user_account;

    let name = &mut ctx.accounts.username_account;
    name.wallet = ctx.accounts.owner.key();
    name.bump = ctx.bumps.username_account;

    Ok(())
}
