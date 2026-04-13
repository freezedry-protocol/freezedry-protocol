use anchor_lang::prelude::*;
use crate::state::Pointer;
use crate::error::PointerError;
use crate::events::PointerCreated;

/// Create an inscription pointer PDA.
///
/// Anyone can create a PDA for any content hash — the hash IS the identity
/// (seeded by it, first-creator-wins). The `inscriber` field is just data
/// the creator fills in — typically the artist's wallet.
///
/// This matches the pointer memo pattern: the memo doesn't care who sends
/// it, only that the content hash is correct.
///
/// Flow:
///   - Artist self-service:  payer = artist, inscriber = artist
///   - Node automation:      payer = node,   inscriber = artist
///   - Backfill/3rd party:   payer = anyone, inscriber = original_artist
#[derive(Accounts)]
#[instruction(content_hash: [u8; 32])]
pub struct CreatePointer<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Pointer::INIT_SPACE,
        seeds = [b"fd-pointer", content_hash.as_ref()],
        bump,
    )]
    pub pointer: Account<'info, Pointer>,

    /// Whoever pays rent and signs the TX. Doesn't have to be the inscriber.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

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
    require!(chunk_count > 0, PointerError::ZeroChunks);
    require!(blob_size > 0, PointerError::ZeroBlobSize);

    let clock = Clock::get()?;
    let pointer = &mut ctx.accounts.pointer;

    pointer.content_hash = content_hash;
    pointer.inscriber = inscriber;
    pointer.collection = Pubkey::default();
    pointer.chunk_count = chunk_count;
    pointer.blob_size = blob_size;
    pointer.last_sig = last_sig;
    pointer.mode = mode;
    pointer.content_type = content_type;
    pointer.slot = clock.slot;
    pointer.timestamp = clock.unix_timestamp;
    pointer.primary_nft = Pubkey::default();
    pointer.version = 1;
    pointer.bump = ctx.bumps.pointer;
    pointer._reserved = [0u8; 32];

    emit!(PointerCreated {
        content_hash,
        inscriber,
        chunk_count,
        blob_size,
        slot: clock.slot,
    });

    Ok(())
}
