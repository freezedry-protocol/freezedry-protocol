//! migrate_pointer_account — Generic realloc IX for growing legacy-sized
//! Pointer PDAs to the current struct size.
//!
//! Background: On 2026-04-13 we deployed fd-pointer v1 with a 260-byte
//! Pointer struct (size = 8 disc + 252 data). On 2026-04-XX we're deploying
//! v2 with a 324-byte struct that adds `title[32]` and widens `_reserved`
//! from `[u8; 32]` to `[u8; 64]`. Any existing v1 PDA (55 of them on
//! mainnet) is still 260 bytes on-chain — Anchor's `Account<Pointer>`
//! wrapper rejects them because it expects 324 bytes.
//!
//! This instruction grows any under-sized Pointer account to the current
//! `Pointer::INIT_SPACE + 8` size via Solana's `realloc` with zero-fill.
//! Post-migration, bytes 0-227 are unchanged from the v1 layout, bytes
//! 228-259 (the old `_reserved[32]` which was always zeros) now read as
//! the new `title` field (empty / blank, the semantically-correct default),
//! and bytes 260-323 are freshly zero-filled as the new `_reserved[64]`.
//!
//! Permissionless: anyone can call this for any Pointer PDA. The caller
//! pays the rent delta (~0.0004 SOL per migration to top up rent-exempt
//! minimum for the additional 64 bytes). No griefing vector — the caller
//! only pays because they WANT the migration done.
//!
//! Generic on purpose: the target size is always `Pointer::INIT_SPACE + 8`
//! read at compile time, so this same IX will work for any future vN → vN+1
//! growth. No per-version migrate IX needed unless we add exotic semantics.
//!
//! Idempotency-safe: a second call on an already-migrated account hits
//! `AlreadyAtTargetSize` and reverts without modifying state.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::Pointer;
use crate::error::PointerError;
use crate::events::PointerAccountMigrated;
use crate::util::{ANCHOR_POINTER_DISCRIMINATOR, MIN_POINTER_ACCOUNT_SIZE};

#[derive(Accounts)]
pub struct MigratePointerAccount<'info> {
    /// The legacy-sized Pointer PDA to migrate.
    ///
    /// CHECK: we validate this account manually in the handler:
    ///   1. Length must be < target size AND >= MIN_POINTER_ACCOUNT_SIZE
    ///   2. First 8 bytes must match the Pointer Anchor discriminator
    /// We use AccountInfo here (not Account<Pointer>) precisely because the
    /// length mismatch with the current Pointer struct is the whole reason
    /// we're migrating — Account<T> would fail deserialization before our
    /// handler runs.
    #[account(mut)]
    pub pointer: AccountInfo<'info>,

    /// Pays the rent delta required to make the newly-enlarged account
    /// rent-exempt. Typically ~0.0004 SOL per migration for our struct.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn migrate_pointer_account(ctx: Context<MigratePointerAccount>) -> Result<()> {
    let pointer_info = &ctx.accounts.pointer;
    let payer = &ctx.accounts.payer;
    let system_program_info = &ctx.accounts.system_program;

    // Ownership check — this MUST be first. `AccountInfo<'info>` skips Anchor's
    // default owner validation (which Account<'info, T> would do), so we must
    // verify manually that the passed account is actually owned by our program
    // (i.e., created by one of our create_pointer IXs). Without this, a caller
    // could pass a non-Pointer account and our realloc would fail at the
    // Solana runtime level with a cryptic error instead of our clean message.
    // See references/security.md: "Validate ownership at trust boundaries."
    require!(
        pointer_info.owner == ctx.program_id,
        PointerError::NotAPointer
    );

    let current_size = pointer_info.data_len();
    let target_size = 8usize + Pointer::INIT_SPACE;

    // Nothing to do if the account is already at (or somehow exceeds) the
    // current layout size. Lets callers retry without worry.
    require!(
        current_size < target_size,
        PointerError::AlreadyAtTargetSize
    );

    // Floor check — any pointer we ever deployed has at least MIN_POINTER_ACCOUNT_SIZE
    // bytes. Anything smaller is corruption (realloc should never go below this).
    require!(
        current_size >= MIN_POINTER_ACCOUNT_SIZE,
        PointerError::AccountTooSmall
    );

    // Verify the Anchor discriminator matches the Pointer account type.
    // Defense in depth alongside the owner check above — any fd-pointer-owned
    // account should have our discriminator, but belt-and-suspenders is cheap.
    // Scope the borrow so we can drop the immutable ref before calling realloc.
    {
        let data = pointer_info.try_borrow_data()?;
        require!(
            data.len() >= 8 && &data[..8] == ANCHOR_POINTER_DISCRIMINATOR,
            PointerError::NotAPointer
        );
    }

    // Top up lamports so the account is rent-exempt at the new larger size.
    let rent = Rent::get()?;
    let required_lamports = rent.minimum_balance(target_size);
    let current_lamports = pointer_info.lamports();
    let rent_delta = required_lamports.saturating_sub(current_lamports);

    if rent_delta > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program_info.to_account_info(),
                system_program::Transfer {
                    from: payer.to_account_info(),
                    to: pointer_info.to_account_info(),
                },
            ),
            rent_delta,
        )?;
    }

    // Grow the account and zero-fill the new bytes.
    // Solana's realloc: (new_len, zero_init) — true = new bytes initialized to 0x00.
    // Max permitted growth is 10KB per tx, we're growing by at most 64 bytes.
    pointer_info.realloc(target_size, true)?;

    // After realloc: bytes [0..old_size) are the pre-existing v1 bytes,
    // bytes [old_size..new_size) are zero. For v1 → v2 specifically:
    //   bytes 228-259 were v1 `_reserved[32]` (always written as zeros by
    //   create_pointer v1) — still zeros now, but reinterpreted as `title`.
    //   bytes 260-323 are brand new zero-fill — the `_reserved[64]`.
    // No field the user cared about has been overwritten.

    emit!(PointerAccountMigrated {
        pda: *pointer_info.key,
        old_size: current_size as u32,
        new_size: target_size as u32,
    });

    Ok(())
}
