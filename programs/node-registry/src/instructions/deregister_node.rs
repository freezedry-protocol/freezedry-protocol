use anchor_lang::prelude::*;
use crate::state::NodeAccount;
use crate::error::RegistryError;

#[derive(Accounts)]
pub struct DeregisterNode<'info> {
    #[account(
        mut,
        close = owner,
        seeds = [b"freeze-node", owner.key().as_ref()],
        bump = node.bump,
        constraint = node.wallet == owner.key() @ RegistryError::Unauthorized,
    )]
    pub node: Account<'info, NodeAccount>,

    /// Node operator — receives rent on close
    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn deregister_node(_ctx: Context<DeregisterNode>) -> Result<()> {
    // close = owner in the account constraint handles rent return + data zeroing
    Ok(())
}
