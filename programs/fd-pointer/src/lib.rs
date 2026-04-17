use anchor_lang::prelude::*;

pub mod state;
pub mod error;
pub mod events;
pub mod instructions;
pub mod util;

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

    /// Create an inscription pointer PDA (v2): accepts upfront `primary_nft` + `collection`
    /// so a caller with the NFT mint already in hand can link at creation time in one tx.
    /// Pass `Pubkey::default()` for either field to leave it unlinked (existing link_nft /
    /// set_collection still work to set them later, same one-shot guards).
    #[allow(clippy::too_many_arguments)]
    pub fn create_pointer_v2(
        ctx: Context<CreatePointerV2>,
        content_hash: [u8; 32],
        inscriber: Pubkey,
        chunk_count: u32,
        blob_size: u32,
        last_sig: [u8; 64],
        mode: u8,
        content_type: u8,
        primary_nft: Pubkey,
        collection: Pubkey,
        title: [u8; 32],
    ) -> Result<()> {
        instructions::create_pointer_v2::create_pointer_v2(
            ctx, content_hash, inscriber, chunk_count, blob_size,
            last_sig, mode, content_type, primary_nft, collection, title,
        )
    }

    /// Finalize a pointer PDA by writing the last-chunk signature. Inscriber-gated,
    /// write-once. Pairs with `create_pointer_v2(..., last_sig = [0; 64], ...)` for
    /// two-phase "create at job start, finalize at job end" inscription flows.
    pub fn update_last_sig(ctx: Context<UpdateLastSig>, last_sig: [u8; 64]) -> Result<()> {
        instructions::update_last_sig::update_last_sig(ctx, last_sig)
    }

    /// Transfer the inscriber role on a pointer PDA. Inscriber-gated. Used by
    /// the hosted flow to hand ownership back to the user after the node has
    /// finalized the PDA via `update_last_sig`. Pass `Pubkey::default()` as
    /// `new_inscriber` to renounce all future inscriber-gated rights.
    ///
    /// Note: `primary_nft` and `collection` remain write-once independent of
    /// who holds the inscriber role.
    pub fn transfer_inscriber(
        ctx: Context<TransferInscriber>,
        new_inscriber: Pubkey,
    ) -> Result<()> {
        instructions::transfer_inscriber::transfer_inscriber(ctx, new_inscriber)
    }

    /// Migrate a legacy-sized Pointer PDA up to the current struct size via
    /// realloc + zero-fill of new bytes. Permissionless — anyone can call
    /// it for any legacy account, caller pays the rent delta. Idempotency-
    /// safe: a second call on an already-migrated account reverts with
    /// AlreadyAtTargetSize.
    ///
    /// Future-proof: the target size is always `Pointer::INIT_SPACE + 8`
    /// read at compile time, so the SAME IX supports v1→v2 today and any
    /// future vN → vN+1 growth with no new migration instruction needed.
    pub fn migrate_pointer_account(ctx: Context<MigratePointerAccount>) -> Result<()> {
        instructions::migrate_pointer_account::migrate_pointer_account(ctx)
    }
}
