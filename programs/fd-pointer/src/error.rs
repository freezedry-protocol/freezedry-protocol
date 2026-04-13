use anchor_lang::prelude::*;

#[error_code]
pub enum PointerError {
    #[msg("Primary NFT has already been linked")]
    AlreadyLinked,

    #[msg("Collection has already been set")]
    CollectionAlreadySet,

    #[msg("Signer is not the inscriber")]
    NotInscriber,

    #[msg("Ed25519 precompile instruction not found")]
    InvalidEd25519Instruction,

    #[msg("Preceding instruction is not the Ed25519 precompile program")]
    InvalidEd25519Program,

    #[msg("Ed25519 precompile must have zero accounts")]
    InvalidEd25519Accounts,

    #[msg("Ed25519 precompile must contain exactly one signature")]
    InvalidSignatureCount,

    #[msg("Ed25519 instruction indices must all be 0xFFFF (data inline)")]
    InvalidInstructionIndices,

    #[msg("Ed25519 public key does not match claimed artist")]
    ArtistMismatch,

    #[msg("Signed message does not match expected format")]
    InvalidMessageFormat,

    #[msg("Ed25519 precompile data is malformed or too short")]
    MalformedPrecompileData,

    #[msg("Chunk count must be greater than zero")]
    ZeroChunks,

    #[msg("Blob size must be greater than zero")]
    ZeroBlobSize,
}
