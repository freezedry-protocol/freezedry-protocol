use anchor_lang::prelude::*;

#[error_code]
pub enum PodError {
    #[msg("Signer is not the config authority")]
    NotAuthority,

    #[msg("Ed25519 precompile instruction not found at expected index")]
    MissingEd25519Instruction,

    #[msg("Ed25519 instruction has wrong program ID")]
    InvalidEd25519Program,

    #[msg("Ed25519 instruction must have zero accounts")]
    InvalidEd25519Accounts,

    #[msg("Ed25519 instruction must contain exactly one signature")]
    InvalidSignatureCount,

    #[msg("Ed25519 instruction indices must all be 0xFFFF")]
    InvalidInstructionIndices,

    #[msg("Ed25519 public key does not match config CDN pubkey")]
    CdnPubkeyMismatch,

    #[msg("Receipt message version unsupported")]
    UnsupportedVersion,

    #[msg("Receipt message is malformed")]
    MalformedMessage,

    #[msg("Receipt timestamp exceeds max_receipt_age")]
    ReceiptExpired,

    #[msg("Receipt epoch does not match instruction arg")]
    EpochMismatch,

    #[msg("Node wallet in receipt does not match submitter")]
    NodeWalletMismatch,

    #[msg("Epoch has been finalized — no more receipts accepted")]
    EpochFinalized,

    #[msg("Epoch has not been finalized yet")]
    EpochNotFinalized,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Receipt nonce does not match instruction arg")]
    NonceMismatch,

    #[msg("Nonce must be strictly greater than last submitted nonce")]
    NonceAlreadyUsed,
}
