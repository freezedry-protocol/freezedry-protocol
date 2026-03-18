use anchor_lang::prelude::*;
use crate::state::NodeAccount;
use crate::error::RegistryError;

#[derive(Accounts)]
pub struct Heartbeat<'info> {
    #[account(
        mut,
        seeds = [b"freeze-node", owner.key().as_ref()],
        bump = node.bump,
        constraint = node.wallet == owner.key() @ RegistryError::Unauthorized,
    )]
    pub node: Account<'info, NodeAccount>,

    /// Node operator — must match node.wallet
    pub owner: Signer<'info>,
}

pub fn heartbeat(ctx: Context<Heartbeat>) -> Result<()> {
    let node = &mut ctx.accounts.node;
    node.last_heartbeat = Clock::get()?.unix_timestamp;
    node.is_active = true;
    Ok(())
}
