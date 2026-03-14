use anchor_lang::prelude::*;
use crate::state::{NodeAccount, NodeRole};
use crate::error::RegistryError;

#[derive(Accounts)]
pub struct RegisterNode<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + NodeAccount::INIT_SPACE,
        seeds = [b"freeze-node", owner.key().as_ref()],
        bump,
    )]
    pub node: Account<'info, NodeAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_node(
    ctx: Context<RegisterNode>,
    node_id: String,
    url: String,
    role: NodeRole,
) -> Result<()> {
    require!(!node_id.is_empty(), RegistryError::EmptyNodeId);
    require!(node_id.len() <= 32, RegistryError::NodeIdTooLong);
    require!(!url.is_empty(), RegistryError::EmptyUrl);
    require!(url.len() <= 128, RegistryError::UrlTooLong);
    require!(url.starts_with("https://"), RegistryError::InvalidUrlScheme);

    let now = Clock::get()?.unix_timestamp;
    let node = &mut ctx.accounts.node;

    node.wallet = ctx.accounts.owner.key();
    node.node_id = node_id;
    node.url = url;
    node.role = role;
    node.registered_at = now;
    node.last_heartbeat = now;
    node.is_active = true;
    node.artworks_indexed = 0;
    node.artworks_complete = 0;
    node.bump = ctx.bumps.node;
    node.verified_stake = 0;
    node.stake_voter = Pubkey::default();
    node.stake_verified_at = 0;
    node._reserved2 = [0u8; 16];

    Ok(())
}
