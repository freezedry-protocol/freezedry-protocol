use anchor_lang::prelude::*;
use crate::state::{NodeAccount, NodeRole};
use crate::error::RegistryError;

#[derive(Accounts)]
pub struct UpdateNode<'info> {
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

pub fn update_node(
    ctx: Context<UpdateNode>,
    url: Option<String>,
    role: Option<NodeRole>,
    node_id: Option<String>,
) -> Result<()> {
    let node = &mut ctx.accounts.node;

    if let Some(new_url) = url {
        require!(!new_url.is_empty(), RegistryError::EmptyUrl);
        require!(new_url.len() <= 128, RegistryError::UrlTooLong);
        require!(new_url.starts_with("https://"), RegistryError::InvalidUrlScheme);
        node.url = new_url;
    }

    if let Some(new_role) = role {
        node.role = new_role;
    }

    if let Some(new_id) = node_id {
        require!(!new_id.is_empty(), RegistryError::EmptyNodeId);
        require!(new_id.len() <= 32, RegistryError::NodeIdTooLong);
        node.node_id = new_id;
    }

    Ok(())
}
