use anchor_lang::prelude::*;
use crate::state::{PodConfig, NodeEpochAccount};
use crate::error::PodError;

#[derive(Accounts)]
#[instruction(epoch: u32)]
pub struct FinalizeEpoch<'info> {
    #[account(
        seeds = [b"fd-pod-config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ PodError::NotAuthority,
    )]
    pub config: Account<'info, PodConfig>,

    #[account(
        mut,
        seeds = [b"fd-pod-node-epoch", epoch.to_le_bytes().as_ref(), node_wallet.key().as_ref()],
        bump = node_epoch.bump,
        constraint = !node_epoch.finalized @ PodError::EpochFinalized,
    )]
    pub node_epoch: Account<'info, NodeEpochAccount>,

    /// CHECK: Node wallet used as PDA seed — not a signer here (authority finalizes)
    pub node_wallet: AccountInfo<'info>,

    pub authority: Signer<'info>,
}

pub fn finalize_epoch(ctx: Context<FinalizeEpoch>, _epoch: u32) -> Result<()> {
    let node_epoch = &mut ctx.accounts.node_epoch;
    node_epoch.finalized = true;

    msg!(
        "Epoch {} finalized for node {}: {} deliveries, {} bytes",
        node_epoch.epoch,
        node_epoch.node_wallet,
        node_epoch.delivery_count,
        node_epoch.bytes_total
    );

    Ok(())
}
