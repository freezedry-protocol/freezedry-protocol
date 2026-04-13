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

    /// Schema version for future realloc (starts at 1)
    pub version: u8,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved for future expansion
    pub _reserved: [u8; 32],
}
