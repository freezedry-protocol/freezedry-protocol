use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("URL exceeds maximum length of 128 characters")]
    UrlTooLong,

    #[msg("Node ID exceeds maximum length of 32 characters")]
    NodeIdTooLong,

    #[msg("URL must start with https://")]
    InvalidUrlScheme,

    #[msg("URL cannot be empty")]
    EmptyUrl,

    #[msg("Node ID cannot be empty")]
    EmptyNodeId,

    #[msg("Unauthorized: signer does not match node wallet")]
    Unauthorized,

    // ── Stake verification errors (6006-6012) ────────────────────────────

    #[msg("Stake account is not owned by the Stake Program")]
    InvalidStakeOwner,

    #[msg("Stake account is not in a delegated state")]
    StakeNotDelegated,

    #[msg("Stake account is deactivating")]
    StakeDeactivating,

    #[msg("Stake account staker/withdrawer does not match the node owner")]
    StakeOwnershipMismatch,

    #[msg("Stake delegation amount is zero")]
    ZeroStake,

    #[msg("Stake account data is too small to be a valid stake account")]
    StakeDataTooSmall,

    #[msg("Signer is not the config authority")]
    NotAuthority,
}
