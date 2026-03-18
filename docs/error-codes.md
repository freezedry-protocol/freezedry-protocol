# FreezeDry — Error Codes

## Jobs Program Errors

| Code | Name | Description |
|------|------|-------------|
| 6000 | InvalidFeeConfig | Fee BPS don't sum to 10,000 |
| 6001 | InvalidJobStatus | Job not in expected status for this operation |
| 6002 | ZeroEscrow | Escrow amount is zero |
| 6003 | ZeroChunks | Chunk count is zero |
| 6004 | InvalidHash | Content hash empty or malformed |
| 6005 | InvalidNodeAccount | Node PDA doesn't match expected format |
| 6006 | NodeWalletMismatch | Node wallet doesn't match signer |
| 6007 | InvalidNodeRole | Node role doesn't permit this action |
| 6008 | NodeNotActive | Node is deactivated |
| 6009 | SelfAttestation | Writer cannot attest their own job |
| 6010 | QuorumNotReached | Not enough attestations for payment release |
| 6011 | NotExpired | Job hasn't expired yet (can't refund/requeue) |
| 6012 | NotCreator | Signer is not the job creator |
| 6013 | NotAssignedWriter | Signer is not the assigned writer |
| 6014 | EmptyPointerSig | Pointer signature is empty |
| 6015 | InvalidMinAttestations | Min attestations must be >= 1 |
| 6016 | Overflow | Arithmetic overflow |
| 6017 | InvalidTreasury | Treasury address is invalid |
| 6018 | InvalidReferrer | Referrer address is invalid |
| 6019 | EscrowTooLow | Escrow below min_escrow_lamports |
| 6020 | ExclusiveWindowActive | Only assigned node can claim during exclusive window |
| 6021 | ExclusiveWindowTooLong | Exclusive window exceeds max allowed |
| 6022 | ReferrerNotRegistered | Referrer PDA doesn't exist |
| 6023 | InvalidReferrerName | Referrer name empty or too long |
| 6024 | BlobSourceTooLong | Blob source URL exceeds 200 chars |
| 6025 | InvalidAttestation | Attestation data invalid |
| 6026 | InvalidAttester | Attester not authorized |
| 6027 | ActiveJobsExist | Can't close config with active jobs |
| 6028 | SelfReferral | Creator cannot be their own referrer |
| 6029 | PendingAuthorityNotSet | No pending authority transfer |
| 6030 | NotProposedAuthority | Signer is not the proposed authority |
| 6031 | StakeDelayNotElapsed | Stake priority delay not met |
| 6032 | StakeVerificationExpired | Stake verification older than 7 days |
| 6033 | InvalidRegistryConfig | Registry config PDA invalid |

## Registry Program Errors

| Code | Name | Description |
|------|------|-------------|
| 6000 | UrlTooLong | URL exceeds maximum length of 128 characters |
| 6001 | NodeIdTooLong | Node ID exceeds maximum length of 32 characters |
| 6002 | InvalidUrlScheme | URL must start with `https://` |
| 6003 | EmptyUrl | URL cannot be empty |
| 6004 | EmptyNodeId | Node ID cannot be empty |
| 6005 | Unauthorized | Signer does not match node wallet |
| 6006 | InvalidStakeOwner | Stake account is not owned by the Stake Program |
| 6007 | StakeNotDelegated | Stake account is not in a delegated state |
| 6008 | StakeDeactivating | Stake account is deactivating |
| 6009 | StakeOwnershipMismatch | Stake account staker/withdrawer does not match the node owner |
| 6010 | ZeroStake | Stake delegation amount is zero |
| 6011 | StakeDataTooSmall | Stake account data is too small to be a valid stake account |
| 6012 | NotAuthority | Signer is not the config authority |
