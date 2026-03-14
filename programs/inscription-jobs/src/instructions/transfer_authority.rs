use anchor_lang::prelude::*;
use crate::state::Config;
use crate::error::JobsError;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [b"fd-config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ JobsError::NotCreator,
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,
}

/// Step 1 of two-step authority transfer: current authority proposes a new authority.
/// The new authority must call accept_authority to complete the transfer.
/// Pass Pubkey::default() to cancel a pending transfer.
pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_authority = new_authority;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(
        mut,
        seeds = [b"fd-config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    pub new_authority: Signer<'info>,
}

/// Step 2 of two-step authority transfer: proposed authority accepts.
/// Clears pending_authority and sets the new authority.
pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;

    require!(
        config.pending_authority != Pubkey::default(),
        JobsError::PendingAuthorityNotSet
    );
    require!(
        config.pending_authority == ctx.accounts.new_authority.key(),
        JobsError::NotProposedAuthority
    );

    config.authority = config.pending_authority;
    config.pending_authority = Pubkey::default();
    Ok(())
}
