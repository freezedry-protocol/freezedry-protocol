use anchor_lang::prelude::*;

pub mod state;
pub mod error;
pub mod instructions;

use instructions::*;

// Placeholder — replaced after first `anchor build` with real program ID
declare_id!("6UGJUc28AuCj8a8sjhsVEKbvYHfQECCuJC7i54vk2to");

#[program]
pub mod freezedry_registry {
    use super::*;

    pub fn register_node(
        ctx: Context<RegisterNode>,
        node_id: String,
        url: String,
        role: state::NodeRole,
    ) -> Result<()> {
        instructions::register_node::register_node(ctx, node_id, url, role)
    }

    pub fn update_node(
        ctx: Context<UpdateNode>,
        url: Option<String>,
        role: Option<state::NodeRole>,
        node_id: Option<String>,
    ) -> Result<()> {
        instructions::update_node::update_node(ctx, url, role, node_id)
    }

    pub fn heartbeat(ctx: Context<Heartbeat>) -> Result<()> {
        instructions::heartbeat::heartbeat(ctx)
    }

    pub fn deregister_node(ctx: Context<DeregisterNode>) -> Result<()> {
        instructions::deregister_node::deregister_node(ctx)
    }

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        preferred_validator: Pubkey,
    ) -> Result<()> {
        instructions::initialize_config::initialize_config(ctx, preferred_validator)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        preferred_validator: Option<Pubkey>,
        new_authority: Option<Pubkey>,
    ) -> Result<()> {
        instructions::update_config::update_config(ctx, preferred_validator, new_authority)
    }

    pub fn verify_stake(ctx: Context<VerifyStake>) -> Result<()> {
        instructions::verify_stake::verify_stake(ctx)
    }
}
