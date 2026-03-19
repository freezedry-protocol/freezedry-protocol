use anchor_lang::prelude::*;
use crate::state::{UserAccount, UsernameAccount, is_valid_username};
use crate::error::BlipError;

#[derive(Accounts)]
#[instruction(new_username: String)]
pub struct UpdateUsername<'info> {
    #[account(
        mut,
        seeds = [b"blip-user", owner.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.wallet == owner.key() @ BlipError::Unauthorized,
    )]
    pub user_account: Account<'info, UserAccount>,

    /// Old username PDA — will be closed (rent returned to owner)
    #[account(
        mut,
        close = owner,
        seeds = [b"blip-name", user_account.username.as_bytes()],
        bump = old_username_account.bump,
        constraint = old_username_account.wallet == owner.key() @ BlipError::Unauthorized,
    )]
    pub old_username_account: Account<'info, UsernameAccount>,

    /// New username PDA — will be initialized
    #[account(
        init,
        payer = owner,
        space = 8 + UsernameAccount::INIT_SPACE,
        seeds = [b"blip-name", new_username.as_bytes()],
        bump,
    )]
    pub new_username_account: Account<'info, UsernameAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn update_username(ctx: Context<UpdateUsername>, new_username: String) -> Result<()> {
    require!(is_valid_username(&new_username), BlipError::InvalidUsername);

    // Update user account with new username
    ctx.accounts.user_account.username = new_username;

    // Initialize new username PDA
    let new_name = &mut ctx.accounts.new_username_account;
    new_name.wallet = ctx.accounts.owner.key();
    new_name.bump = ctx.bumps.new_username_account;

    // Old username PDA closed automatically by `close = owner` constraint

    Ok(())
}
