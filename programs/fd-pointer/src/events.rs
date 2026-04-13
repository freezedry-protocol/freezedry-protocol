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
