use anchor_lang::prelude::*;

/// Immutable on-chain pointer PDA for inscription discovery.
/// One PDA per unique content hash. First inscriber wins.
///
/// PDA seeds: [b"fd-pointer", content_hash]
#[account]
#[derive(InitSpace)]
pub struct Pointer {
    /// SHA-256 of the inscribed blob — THE identity and PDA seed
    pub content_hash: [u8; 32],

    /// Artist who authorized the inscription (signer or ed25519-verified)
    pub inscriber: Pubkey,

    /// Metaplex collection address.
    /// Pubkey::default() = standalone (not part of a collection).
    /// Set-once mutable: starts default, artist sets once, locks forever.
    pub collection: Pubkey,

    /// Total memo chunks inscribed on-chain
    pub chunk_count: u32,

    /// Total blob size in bytes
    pub blob_size: u32,

    /// Last chunk TX signature — reconstruction entry point (64 raw bytes)
    pub last_sig: [u8; 64],

    /// Inscription mode: 0=open, 1=encrypted, 3=direct
    pub mode: u8,

    /// Content type: 0=image, 1=document, 2=certificate, 3=video, 4=audio, 5=other
    /// Informational — helps frontends display the right icon/preview
    pub content_type: u8,

    /// Solana slot at PDA creation (half of FD# = slot.txIndex)
    pub slot: u64,

    /// Unix timestamp at PDA creation (from Clock sysvar)
    pub timestamp: i64,

    /// Primary NFT mint address.
    /// Pubkey::default() = unlinked.
    /// Set-once mutable: artist sets once, locks forever.
    pub primary_nft: Pubkey,

    /// Schema version for future realloc (v1 = 1, v2 = 2)
    pub version: u8,

    /// PDA bump seed
    pub bump: u8,

    /// Artwork / file title. UTF-8 bytes, right-padded with zeros.
    /// Partners supply >32-byte input — clients truncate at the last complete
    /// UTF-8 code-point boundary before calling (no invalid UTF-8 ever lands
    /// on-chain). Set once at PDA creation via create_pointer_v2; v1 creates
    /// leave this as zeros. Never mutated by any subsequent instruction.
    pub title: [u8; 32],

    /// Reserved for future expansion (v3+). 64 bytes = room for two more
    /// Pubkey-sized fields without another program upgrade.
    pub _reserved: [u8; 64],
}

// ═══════════════════════════════════════════════════════════════════════
// Compile-time invariants — these fail the build if the struct drifts.
// Change ANY field size, add/remove ANY field, and these asserts will
// stop compilation until we explicitly acknowledge the new layout.
//
// Paired with Lean proofs in formal_verification/Proofs/FdPointerV2Title.lean
// (theorem T2a: INIT_SPACE = 316). Both numbers MUST stay in sync with
// `POINTER_PDA_RENT_LAMPORTS` in hydrate/api/partner.js (3,145,920 lamports).
//
// If this assertion fires, you have THREE places to update:
//   1. This assertion (with the new size + a comment explaining why it changed)
//   2. Lean proof T2a in formal_verification/Proofs/FdPointerV2Title.lean
//   3. POINTER_PDA_RENT_LAMPORTS = (new_account_size + 128) × 6960 in partner.js
// ═══════════════════════════════════════════════════════════════════════
const _: () = assert!(
    Pointer::INIT_SPACE == 316,
    "Pointer struct layout changed — see state.rs comment above this assertion"
);
