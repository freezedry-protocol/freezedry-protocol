use anchor_lang::prelude::*;
use crate::state::{JobAccount, JobStatus};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct SubmitReceipt<'info> {
    #[account(
        mut,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = job.status == JobStatus::Claimed @ JobsError::InvalidJobStatus,
        constraint = job.writer == writer.key() @ JobsError::NotAssignedWriter,
    )]
    pub job: Account<'info, JobAccount>,

    pub writer: Signer<'info>,
}

pub fn submit_receipt(
    ctx: Context<SubmitReceipt>,
    pointer_sig: String,
) -> Result<()> {
    require!(!pointer_sig.is_empty(), JobsError::EmptyPointerSig);
    require!(pointer_sig.len() <= 128, JobsError::EmptyPointerSig);

    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    job.pointer_sig = pointer_sig;
    job.status = JobStatus::Submitted;
    job.submitted_at = now;

    Ok(())
}
