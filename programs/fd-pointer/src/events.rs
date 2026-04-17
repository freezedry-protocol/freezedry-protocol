use anchor_lang::prelude::*;

#[event]
pub struct PointerCreated {
    pub content_hash: [u8; 32],
    pub inscriber: Pubkey,
    pub chunk_count: u32,
    pub blob_size: u32,
    pub slot: u64,
}

#[event]
pub struct NftLinked {
    pub content_hash: [u8; 32],
    pub nft_mint: Pubkey,
}

#[event]
pub struct CollectionSet {
    pub content_hash: [u8; 32],
    pub collection: Pubkey,
}

/// Emitted by create_pointer_v2. Extends PointerCreated with primary_nft +
/// collection (populated at creation time rather than defaulting to
/// Pubkey::default()) and title (UTF-8, zero-padded to 32 bytes).
#[event]
pub struct PointerCreatedV2 {
    pub content_hash: [u8; 32],
    pub inscriber: Pubkey,
    pub chunk_count: u32,
    pub blob_size: u32,
    pub slot: u64,
    pub primary_nft: Pubkey,
    pub collection: Pubkey,
    pub title: [u8; 32],
}

/// Emitted by update_last_sig when an inscription's finalization signature
/// is written to its pointer PDA.
#[event]
pub struct LastSigUpdated {
    pub content_hash: [u8; 32],
    pub last_sig: [u8; 64],
}

/// Emitted when the `inscriber` role on a pointer PDA transfers to a new
/// pubkey. Lets indexers + marketplaces track the chain of control over
/// a PDA's one-shot write rights (`link_nft`, `set_collection`,
/// `update_last_sig`). `new_inscriber == Pubkey::default()` signals the
/// previous inscriber has renounced control — no one can ever call
/// inscriber-gated IXs on this PDA again.
#[event]
pub struct InscriberTransferred {
    pub content_hash: [u8; 32],
    pub old_inscriber: Pubkey,
    pub new_inscriber: Pubkey,
}

/// Emitted when a legacy-sized Pointer PDA is reallocated up to the current
/// struct's INIT_SPACE + discriminator bytes. The account's pre-existing
/// bytes [0..old_size) are unchanged; bytes [old_size..new_size) are
/// zero-filled by Solana's realloc. Downstream readers can treat a v1 PDA
/// post-migration identically to a v2-created PDA with empty title +
/// zeroed reserved.
#[event]
pub struct PointerAccountMigrated {
    pub pda: Pubkey,
    pub old_size: u32,
    pub new_size: u32,
}
