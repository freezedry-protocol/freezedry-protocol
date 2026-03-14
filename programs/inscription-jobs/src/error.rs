use anchor_lang::prelude::*;

#[error_code]
pub enum JobsError {
    #[msg("Invalid fee configuration: must sum to 10000 bps")]
    InvalidFeeConfig,

    #[msg("Job is not in the expected status for this operation")]
    InvalidJobStatus,

    #[msg("Escrow amount must be greater than zero")]
    ZeroEscrow,

    #[msg("Chunk count must be greater than zero")]
    ZeroChunks,

    #[msg("Content hash format invalid")]
    InvalidHash,

    #[msg("Node account is not a valid registry NodeAccount")]
    InvalidNodeAccount,

    #[msg("Node wallet does not match signer")]
    NodeWalletMismatch,

    #[msg("Node does not have the required role")]
    InvalidNodeRole,

    #[msg("Node is not active")]
    NodeNotActive,

    #[msg("Writer cannot self-attest their own job")]
    SelfAttestation,

    #[msg("Attestation quorum not yet reached")]
    QuorumNotReached,

    #[msg("Job has not expired yet")]
    NotExpired,

    #[msg("Only the job creator can perform this action")]
    NotCreator,

    #[msg("Only the assigned writer can submit receipt")]
    NotAssignedWriter,

    #[msg("Pointer signature cannot be empty")]
    EmptyPointerSig,

    #[msg("Minimum attestations must be at least 1")]
    InvalidMinAttestations,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Treasury account does not match config")]
    InvalidTreasury,

    #[msg("Referrer account does not match job.referrer")]
    InvalidReferrer,

    #[msg("Escrow amount is below the minimum required")]
    EscrowTooLow,

    #[msg("Assigned node has exclusive claim window — wait for expiry or use assigned node")]
    ExclusiveWindowActive,

    #[msg("Exclusive window exceeds maximum allowed by config")]
    ExclusiveWindowTooLong,

    #[msg("Referrer wallet does not have a registered ReferrerAccount PDA")]
    ReferrerNotRegistered,

    #[msg("Referrer name must be 1-64 characters")]
    InvalidReferrerName,

    #[msg("Blob source URL exceeds 200 character limit")]
    BlobSourceTooLong,

    #[msg("Attestation must be valid (is_valid == true)")]
    InvalidAttestation,

    #[msg("Attester account does not match attestation.reader")]
    InvalidAttester,

    #[msg("Cannot close config while jobs are in-flight")]
    ActiveJobsExist,

    #[msg("Creator cannot self-refer")]
    SelfReferral,

    #[msg("Proposed authority must accept the transfer")]
    PendingAuthorityNotSet,

    #[msg("Only the proposed authority can accept the transfer")]
    NotProposedAuthority,

    #[msg("Unstaked node must wait for claim delay to elapse")]
    StakeDelayNotElapsed,

    #[msg("Node stake verification has expired")]
    StakeVerificationExpired,

    #[msg("Registry config account is invalid")]
    InvalidRegistryConfig,
}
