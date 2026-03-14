use anchor_lang::prelude::*;

pub mod state;
pub mod error;
pub mod instructions;

use instructions::*;

// Placeholder — replaced after first build with real program ID
declare_id!("2hTh2yTcXhxEvz3hFAhGiUNm2eQoEvQvrAn5C1aNkm2W");

#[program]
pub mod freezedry_pod {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        cdn_pubkey: [u8; 32],
        epoch_length: u32,
        max_receipt_age: u32,
    ) -> Result<()> {
        instructions::initialize_config::initialize_config(ctx, cdn_pubkey, epoch_length, max_receipt_age)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        cdn_pubkey: Option<[u8; 32]>,
        epoch_length: Option<u32>,
        max_receipt_age: Option<u32>,
        new_authority: Option<Pubkey>,
    ) -> Result<()> {
        instructions::update_config::update_config(ctx, cdn_pubkey, epoch_length, max_receipt_age, new_authority)
    }

    pub fn submit_receipt(
        ctx: Context<SubmitReceipt>,
        nonce: u64,
        epoch: u32,
    ) -> Result<()> {
        instructions::submit_receipt::submit_receipt(ctx, nonce, epoch)
    }

    pub fn finalize_epoch(ctx: Context<FinalizeEpoch>, epoch: u32) -> Result<()> {
        instructions::finalize_epoch::finalize_epoch(ctx, epoch)
    }
}
