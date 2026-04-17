use anchor_lang::prelude::*;
use crate::state::Pointer;
use crate::error::PointerError;
use crate::events::InscriberTransferred;

/// Transfer the `inscriber` field on a pointer PDA to a new pubkey.
///
/// The `inscriber` controls the one-shot write-once ops (`link_nft`,
/// `set_collection`, `update_last_sig`). Transferring hands those rights to
/// someone else. Usage pattern for hosted flows:
///
///   1. User pays + signs one composite TX that records `inscriber = GCP node`
///      so GCP can finalize `update_last_sig` after chunk work completes.
///   2. After finalization, GCP (the current inscriber) calls
///      `transfer_inscriber(new_inscriber = user)` as a one-time hand-off.
///   3. From that point on, the user owns the PDA. GCP has no rights to it.
///      If Freeze Dry disappears, the user can still call `link_nft` /
///      `set_collection` from their own wallet.
///
/// Passing `Pubkey::default()` as `new_inscriber` effectively renounces all
/// inscriber rights — no one can ever call inscriber-gated IXs on this PDA
/// again. Useful for making a PDA truly permanent + untouchable.
///
/// Immutability properties of the PDA fields themselves are unchanged:
/// `primary_nft` and `collection` remain write-once — the inscriber role
/// only gates the ABILITY to call those IXs. Once either field is set, it's
/// locked for everyone including the current and any future inscribers.
#[derive(Accounts)]
pub struct TransferInscriber<'info> {
    #[account(
        mut,
        seeds = [b"fd-pointer", pointer.content_hash.as_ref()],
        bump = pointer.bump,
        constraint = inscriber.key() == pointer.inscriber @ PointerError::NotInscriber,
    )]
    pub pointer: Account<'info, Pointer>,

    /// Must be the current inscriber on the PDA.
    pub inscriber: Signer<'info>,
}

pub fn transfer_inscriber(
    ctx: Context<TransferInscriber>,
    new_inscriber: Pubkey,
) -> Result<()> {
    let pointer = &mut ctx.accounts.pointer;
    let old_inscriber = pointer.inscriber;

    // No-op guard: transferring to the same inscriber is a waste of rent.
    // (Not an error — just a cheap check that logs clearly if someone does it.)
    if new_inscriber == old_inscriber {
        msg!("transfer_inscriber: new_inscriber == current; no-op");
        return Ok(());
    }

    pointer.inscriber = new_inscriber;

    emit!(InscriberTransferred {
        content_hash: pointer.content_hash,
        old_inscriber,
        new_inscriber,
    });

    Ok(())
}
