use anchor_lang::prelude::*;

#[error_code]
pub enum PointerError {
    #[msg("Primary NFT has already been linked")]
    AlreadyLinked,

    #[msg("Collection has already been set")]
    CollectionAlreadySet,

    #[msg("Signer is not the inscriber")]
    NotInscriber,

    #[msg("Chunk count must be greater than zero")]
    ZeroChunks,

    #[msg("Blob size must be greater than zero")]
    ZeroBlobSize,

    #[msg("Last signature has already been finalized")]
    AlreadyFinalized,

    #[msg("Last signature cannot be all zeros — that's the sentinel for unfinalized")]
    ZeroLastSig,

    #[msg("Title contains invalid UTF-8 bytes")]
    InvalidTitle,

    #[msg("Pointer account is already at or above the current struct size — no migration needed")]
    AlreadyAtTargetSize,

    #[msg("Account is not a Pointer PDA (discriminator mismatch)")]
    NotAPointer,

    #[msg("Account is too small to be a valid historical Pointer PDA")]
    AccountTooSmall,
}
