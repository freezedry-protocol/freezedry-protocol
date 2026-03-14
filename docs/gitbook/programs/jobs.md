# Inscription Jobs

The Jobs program manages the inscription marketplace: job creation, claiming, verification, and payment.

## Instructions (19)

| Category | Instructions |
|----------|-------------|
| Config | `initialize`, `update_config`, `close_config` |
| Job lifecycle | `create_job`, `claim_job`, `submit_receipt` |
| Verification | `attest`, `release_payment` |
| Cancellation | `cancel_job`, `refund_expired`, `requeue_expired` |
| Cleanup | `close_completed_job`, `close_attestation`, `admin_close_*` |
| Referral | `register_referrer`, `close_referrer` |
| Authority | `transfer_authority`, `accept_authority` |

## State Accounts

| Account | Seed | Purpose |
|---------|------|---------|
| `Config` | `["fd-config"]` | Global fee splits, escrow floor, job expiry |
| `JobAccount` | `["fd-job", job_id]` | Per-job state, escrow, timestamps, BPS snapshot |
| `VerificationAttestation` | `["fd-attest", job_id, reader]` | Per-attestation proof |
| `ReferrerAccount` | `["fd-referrer", wallet]` | Registered referrer identity |

## Job Lifecycle

```
create_job → claim_job → submit_receipt → attest → release_payment
```

1. **Create** — User deposits escrow, specifies blob hash, chunk count, optional assigned node
2. **Claim** — Writer claims the job (stake-based priority: preferred validator → staked → unstaked)
3. **Submit receipt** — Writer inscribes all chunks, submits pointer signature as proof
4. **Attest** — Reader independently verifies inscription integrity (SHA-256 match)
5. **Release payment** — Two-step split: TX reimbursement to writer, margin split by BPS

## Security

- Fee BPS snapshot locked at job creation (can't change mid-flight)
- Self-referral blocked
- Self-attestation blocked
- Exclusive claim window for assigned nodes (default 30 min, max 1 hr)
- Escrow floor enforced on-chain (rejects unpayable jobs)
- Failed attestation auto-requeues job
- Two-step authority transfer (transfer + accept)

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | Unauthorized | Caller is not the authority |
| 6001 | InvalidJobState | Job is not in the expected state |
| 6002 | InsufficientEscrow | Escrow below minimum |
| 6003 | JobExpired | Job has passed expiry window |
| 6004 | JobNotExpired | Cannot refund — job hasn't expired yet |
| 6005 | InvalidHash | Content hash format invalid |
| 6006 | QuorumNotMet | Not enough attestations for payment release |
| 6007 | SelfAttestation | Writer cannot attest own job |
| 6008 | AlreadyAttested | This reader already attested this job |
| 6009 | SelfReferral | Creator cannot be their own referrer |
| 6010 | InvalidReferrer | Referrer account not registered |
| 6011 | NodeNotRegistered | Claiming node not in registry |
| 6012 | ExclusiveWindowActive | Assigned node has exclusive claim window |
| 6013 | InvalidStakeTier | Stake tier delay not elapsed |
