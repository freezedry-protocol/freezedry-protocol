use anchor_lang::prelude::*;
use crate::state::Pointer;
use crate::error::PointerError;
use crate::events::PointerCreatedV2;

/// Create an inscription pointer PDA (v2).
///
/// Same as `create_pointer` but accepts upfront `primary_nft` and `collection`
/// so a caller with the NFT mint already in hand can link it at creation time
/// rather than making two more txs (`link_nft` + `set_collection`).
///
/// Pass `Pubkey::default()` for either field to leave it unlinked — the existing
/// `link_nft` / `set_collection` ixs can still set them later (same one-shot guards).
///
/// This is additive to `create_pointer` (v1 stays, both work). Partner API
/// flow migrates to v2 to enable EA's at-mint linking in one round-trip.
#[derive(Accounts)]
#[instruction(content_hash: [u8; 32])]
pub struct CreatePointerV2<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Pointer::INIT_SPACE,
        seeds = [b"fd-pointer", content_hash.as_ref()],
        bump,
    )]
    pub pointer: Account<'info, Pointer>,

    /// Rent payer + TX signer. Can be any wallet — not required to be the inscriber.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

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
    require!(chunk_count > 0, PointerError::ZeroChunks);
    require!(blob_size > 0, PointerError::ZeroBlobSize);

    // Enforce valid UTF-8 on the title bytes up to the first null byte.
    // Clients are expected to UTF-8-safe truncate to ≤32 bytes and zero-pad
    // the remainder. We reject any non-UTF-8 bytes in the non-padding prefix
    // so no invalid UTF-8 ever lands on-chain (matches formal proof T1).
    // Pass [0; 32] for "no title". The validation logic lives in util.rs so
    // proptest can fuzz it in isolation.
    require!(
        crate::util::is_valid_title_utf8(&title),
        PointerError::InvalidTitle
    );

    let clock = Clock::get()?;
    let pointer = &mut ctx.accounts.pointer;

    pointer.content_hash = content_hash;
    pointer.inscriber = inscriber;
    pointer.collection = collection;
    pointer.chunk_count = chunk_count;
    pointer.blob_size = blob_size;
    pointer.last_sig = last_sig;
    pointer.mode = mode;
    pointer.content_type = content_type;
    pointer.slot = clock.slot;
    pointer.timestamp = clock.unix_timestamp;
    pointer.primary_nft = primary_nft;
    pointer.version = 2;
    pointer.bump = ctx.bumps.pointer;
    pointer.title = title;
    pointer._reserved = [0u8; 64];

    emit!(PointerCreatedV2 {
        content_hash,
        inscriber,
        chunk_count,
        blob_size,
        slot: clock.slot,
        primary_nft,
        collection,
        title,
    });

    Ok(())
}
