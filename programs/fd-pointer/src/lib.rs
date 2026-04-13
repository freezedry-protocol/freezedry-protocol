use anchor_lang::prelude::*;

pub mod state;
pub mod error;
pub mod events;
pub mod instructions;

use instructions::*;

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Freeze Dry Pointer",
    project_url: "https://freezedry.art",
    contacts: "email:dogame900@gmail.com,link:https://t.me/freezedryart",
    policy: "https://freezedry.art/security",
    preferred_languages: "en",
    source_code: "https://github.com/freezedry-protocol/freezedry-protocol",
    auditors: "N/A"
}

declare_id!("FrzDrykT4XSp5BwdYdSJdLHbDVVPuquN2cDMJyVJ35iJ");

#[program]
pub mod fd_pointer {
    use super::*;

    /// Create an inscription pointer PDA.
    /// Anyone signs + pays rent. `inscriber` is the recorded identity (typically the artist).
    pub fn create_pointer(
        ctx: Context<CreatePointer>,
        content_hash: [u8; 32],
        inscriber: Pubkey,
        chunk_count: u32,
        blob_size: u32,
        last_sig: [u8; 64],
        mode: u8,
        content_type: u8,
    ) -> Result<()> {
        instructions::create_pointer::create_pointer(
            ctx, content_hash, inscriber, chunk_count, blob_size, last_sig, mode, content_type,
        )
    }

    /// Link a primary NFT mint to an inscription. One-shot — locks forever.
    /// Only the inscriber (as recorded in the PDA) can call this.
    pub fn link_nft(ctx: Context<LinkNft>, nft_mint: Pubkey) -> Result<()> {
        instructions::link_nft::link_nft(ctx, nft_mint)
    }

    /// Set the collection for an inscription. One-shot — locks forever.
    /// Only the inscriber (as recorded in the PDA) can call this.
    pub fn set_collection(ctx: Context<SetCollection>, collection: Pubkey) -> Result<()> {
        instructions::set_collection::set_collection(ctx, collection)
    }
}
