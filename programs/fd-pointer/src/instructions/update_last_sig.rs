use anchor_lang::prelude::*;
use crate::state::Pointer;
use crate::error::PointerError;
use crate::events::LastSigUpdated;

/// Finalize an inscription by writing the last-chunk signature onto an existing
/// pointer PDA. Inscriber-gated, write-once.
///
/// Intended pairing with `create_pointer_v2`:
///   1. Caller calls `create_pointer_v2(..., last_sig = [0; 64], ...)` at the
///      start of an inscription job — the PDA exists, ready to be discovered.
///   2. Caller inscribes N memo chunks on-chain.
///   3. After the final chunk is confirmed, caller calls `update_last_sig(<real>)`
///      to lock the PDA with the reconstruction entry point.
///
/// Once set (i.e. `last_sig != [0; 64]`), the field is locked forever.
#[derive(Accounts)]
pub struct UpdateLastSig<'info> {
    #[account(
        mut,
        seeds = [b"fd-pointer", pointer.content_hash.as_ref()],
        bump = pointer.bump,
        constraint = inscriber.key() == pointer.inscriber @ PointerError::NotInscriber,
        constraint = pointer.last_sig == [0u8; 64] @ PointerError::AlreadyFinalized,
    )]
    pub pointer: Account<'info, Pointer>,

    /// Must be the inscriber recorded on the PDA.
    pub inscriber: Signer<'info>,
}

pub fn update_last_sig(ctx: Context<UpdateLastSig>, last_sig: [u8; 64]) -> Result<()> {
    // Guard: reject explicit zero writes. [0u8; 64] is the sentinel for
    // "unfinalized" on the PDA — writing zeros would be a no-op that looks
    // like finalization succeeded. Distinct from AlreadyFinalized (which
    // fires via the account constraint when the PDA is already non-zero).
    require!(last_sig != [0u8; 64], PointerError::ZeroLastSig);

    let pointer = &mut ctx.accounts.pointer;
    pointer.last_sig = last_sig;

    emit!(LastSigUpdated {
        content_hash: pointer.content_hash,
        last_sig,
    });

    Ok(())
}
