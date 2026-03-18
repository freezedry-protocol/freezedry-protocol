use anchor_lang::prelude::*;
use crate::state::{Config, JobAccount, JobStatus, VerificationAttestation};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct ReleasePayment<'info> {
    #[account(
        mut,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = job.status == JobStatus::Submitted @ JobsError::InvalidJobStatus,
    )]
    pub job: Account<'info, JobAccount>,

    #[account(
        mut,
        seeds = [b"fd-config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Validated against job.writer
    #[account(
        mut,
        constraint = inscriber.key() == job.writer @ JobsError::NotAssignedWriter,
    )]
    pub inscriber: AccountInfo<'info>,

    /// CHECK: Validated against config.treasury
    #[account(
        mut,
        constraint = treasury.key() == config.treasury @ JobsError::InvalidTreasury,
    )]
    pub treasury: AccountInfo<'info>,

    /// CHECK: Validated against job.referrer
    #[account(
        mut,
        constraint = referrer.key() == job.referrer @ JobsError::InvalidReferrer,
    )]
    pub referrer: AccountInfo<'info>,

    /// Attestation PDA — proves who verified this job.
    /// The attester (attestation.reader) gets the attester fee share.
    #[account(
        seeds = [
            b"fd-attest",
            job.job_id.to_le_bytes().as_ref(),
            attestation.reader.as_ref(),
        ],
        bump = attestation.bump,
        constraint = attestation.is_valid @ JobsError::InvalidAttestation,
    )]
    pub attestation: Account<'info, VerificationAttestation>,

    /// CHECK: Validated against attestation.reader — the wallet that verified the inscription
    #[account(
        mut,
        constraint = attester.key() == attestation.reader @ JobsError::InvalidAttester,
    )]
    pub attester: AccountInfo<'info>,

    /// Anyone can trigger payment release (permissionless)
    pub signer: Signer<'info>,
}

pub fn release_payment(ctx: Context<ReleasePayment>) -> Result<()> {
    let job = &ctx.accounts.job;
    let config = &ctx.accounts.config;

    // Verify quorum
    require!(
        job.attestation_count >= config.min_attestations,
        JobsError::QuorumNotReached
    );

    let escrow = job.escrow_lamports;
    let tx_reimburse = job.tx_reimbursement_lamports;

    // Two-step split: reimburse TX costs first, then split margin by BPS.
    // Step 1: Writer gets tx_reimburse (covers Solana TX costs, pass-through)
    // Step 2: Margin (escrow - reimburse) split by BPS (pure profit for all)
    // If base_tx_fee was 0 at job creation, tx_reimburse = 0 and entire escrow is margin.
    let margin = if tx_reimburse > 0 {
        escrow.checked_sub(tx_reimburse)
            .ok_or(error!(JobsError::Overflow))?
    } else {
        escrow
    };

    // Use fee BPS snapshotted at job creation (immutable deal terms)
    let inscriber_margin = margin
        .checked_mul(job.snap_inscriber_bps as u64)
        .and_then(|v| v.checked_div(10000))
        .ok_or(error!(JobsError::Overflow))?;

    // Attester share (was indexer_bps, now pays the node that verified)
    let attester_amount = margin
        .checked_mul(job.snap_indexer_bps as u64)
        .and_then(|v| v.checked_div(10000))
        .ok_or(error!(JobsError::Overflow))?;

    // Referral share
    let referral_amount = margin
        .checked_mul(job.snap_referral_bps as u64)
        .and_then(|v| v.checked_div(10000))
        .ok_or(error!(JobsError::Overflow))?;

    // Treasury gets the remainder (absorbs rounding dust)
    let treasury_amount = margin
        .checked_sub(inscriber_margin)
        .and_then(|v| v.checked_sub(attester_amount))
        .and_then(|v| v.checked_sub(referral_amount))
        .ok_or(error!(JobsError::Overflow))?;

    // Total inscriber payout = TX reimbursement (pass-through) + margin share (profit)
    let inscriber_total = tx_reimburse
        .checked_add(inscriber_margin)
        .ok_or(error!(JobsError::Overflow))?;

    let job_info = ctx.accounts.job.to_account_info();
    let inscriber_info = ctx.accounts.inscriber.to_account_info();
    let treasury_info = ctx.accounts.treasury.to_account_info();
    let referrer_info = ctx.accounts.referrer.to_account_info();
    let attester_info = ctx.accounts.attester.to_account_info();

    // Pay inscriber (TX reimbursement + margin share)
    **job_info.try_borrow_mut_lamports()? -= inscriber_total;
    **inscriber_info.try_borrow_mut_lamports()? += inscriber_total;

    // Pay attester (verification reward)
    if attester_amount > 0 {
        **job_info.try_borrow_mut_lamports()? -= attester_amount;
        **attester_info.try_borrow_mut_lamports()? += attester_amount;
    }

    // Pay treasury
    **job_info.try_borrow_mut_lamports()? -= treasury_amount;
    **treasury_info.try_borrow_mut_lamports()? += treasury_amount;

    // Pay referrer — redirect to treasury if no external referrer
    **job_info.try_borrow_mut_lamports()? -= referral_amount;
    if job.referrer == Pubkey::default() {
        **treasury_info.try_borrow_mut_lamports()? += referral_amount;
    } else {
        **referrer_info.try_borrow_mut_lamports()? += referral_amount;
    }

    // Update job state
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    job.status = JobStatus::Completed;
    job.completed_at = now;

    // Increment completed counter
    let config = &mut ctx.accounts.config;
    config.total_jobs_completed = config
        .total_jobs_completed
        .checked_add(1)
        .ok_or(error!(JobsError::Overflow))?;

    Ok(())
}
