use anchor_lang::prelude::*;
use crate::state::{JobAccount, JobStatus, VerificationAttestation};
use crate::error::JobsError;

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct CloseAttestation<'info> {
    #[account(
        mut,
        close = reader,
        seeds = [b"fd-attest", job_id.to_le_bytes().as_ref(), reader.key().as_ref()],
        bump = attestation.bump,
    )]
    pub attestation: Account<'info, VerificationAttestation>,

    /// Job must be Completed, Cancelled, or Expired (attestation no longer needed)
    #[account(
        seeds = [b"fd-job", job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = matches!(job.status, JobStatus::Completed | JobStatus::Cancelled | JobStatus::Expired)
            @ JobsError::InvalidJobStatus,
    )]
    pub job: Account<'info, JobAccount>,

    /// CHECK: Must match attestation.reader — receives rent refund (reader paid the rent)
    #[account(mut, constraint = reader.key() == attestation.reader @ JobsError::NotCreator)]
    pub reader: AccountInfo<'info>,

    /// Anyone can trigger close (permissionless)
    pub signer: Signer<'info>,
}

/// Permissionless close: any signer can close attestation PDAs for finished jobs.
/// Rent returns to the original job creator. Prevents stranded rent.
pub fn close_attestation(_ctx: Context<CloseAttestation>, _job_id: u64) -> Result<()> {
    msg!("Attestation PDA closed — rent returned to reader");
    Ok(())
}
