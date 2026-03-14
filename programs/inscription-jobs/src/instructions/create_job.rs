use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::Discriminator;
use crate::state::{Config, JobAccount, JobStatus, ReferrerAccount};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct CreateJob<'info> {
    #[account(
        mut,
        seeds = [b"fd-config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = 8 + JobAccount::INIT_SPACE,
        seeds = [b"fd-job", config.total_jobs_created.to_le_bytes().as_ref()],
        bump,
    )]
    pub job: Account<'info, JobAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Optional referrer PDA. Validated in handler when referrer != default/treasury.
    /// Pass SystemProgram.programId as placeholder when no referrer or treasury referrer.
    pub referrer_account: AccountInfo<'info>,
}

pub fn create_job(
    ctx: Context<CreateJob>,
    content_hash: String,
    chunk_count: u32,
    escrow_amount: u64,
    referrer: Pubkey,
    assigned_node: Pubkey,
    exclusive_window: u32,
    blob_source: String,
) -> Result<()> {
    require!(escrow_amount > 0, JobsError::ZeroEscrow);
    require!(chunk_count > 0, JobsError::ZeroChunks);
    require!(!content_hash.is_empty() && content_hash.len() <= 71, JobsError::InvalidHash);
    require!(blob_source.len() <= 200, JobsError::BlobSourceTooLong);

    // Enforce minimum escrow — prevents free-work abuse.
    // Authority sets min_escrow_lamports to track ~$2 USD at current SOL price.
    let min_escrow = ctx.accounts.config.min_escrow_lamports;
    if min_escrow > 0 {
        require!(escrow_amount >= min_escrow, JobsError::EscrowTooLow);
    }

    // Block self-referral — creator cannot earn their own referral fee
    if referrer != Pubkey::default() && referrer != ctx.accounts.config.treasury {
        require!(referrer != ctx.accounts.creator.key(), JobsError::SelfReferral);
    }

    // Validate referrer PDA — skip for no-referrer or treasury-default cases
    if referrer != Pubkey::default() && referrer != ctx.accounts.config.treasury {
        let referrer_info = &ctx.accounts.referrer_account;

        // Verify PDA derivation matches the referrer pubkey
        let (expected_pda, _) = Pubkey::find_program_address(
            &[b"fd-referrer", referrer.as_ref()],
            ctx.program_id,
        );
        require!(
            referrer_info.key() == expected_pda,
            JobsError::ReferrerNotRegistered
        );

        // Verify account is owned by this program (initialized)
        require!(
            *referrer_info.owner == crate::ID,
            JobsError::ReferrerNotRegistered
        );

        // Verify discriminator matches ReferrerAccount
        let data = referrer_info.try_borrow_data()?;
        require!(data.len() >= 8, JobsError::ReferrerNotRegistered);
        require!(data[..8] == *ReferrerAccount::DISCRIMINATOR, JobsError::ReferrerNotRegistered);
    }

    // Transfer escrow SOL from creator to the job PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.job.to_account_info(),
            },
        ),
        escrow_amount,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    let job_id = config.total_jobs_created;

    // Compute exclusive_until for assigned-node routing
    let exclusive_until = if assigned_node != Pubkey::default() {
        let window = if exclusive_window == 0 {
            config.default_exclusive_window
        } else {
            // Cap at max — prevents abuse
            let max = config.max_exclusive_window;
            if max > 0 && exclusive_window > max {
                return err!(JobsError::ExclusiveWindowTooLong);
            }
            exclusive_window
        };
        now.checked_add(window as i64).ok_or(error!(JobsError::Overflow))?
    } else {
        0i64
    };

    // Increment the global counter
    config.total_jobs_created = config
        .total_jobs_created
        .checked_add(1)
        .ok_or(error!(JobsError::Overflow))?;

    // Compute TX reimbursement if base_tx_fee is set
    let base_tx_fee = config.base_tx_fee_lamports;
    let tx_reimbursement = if base_tx_fee > 0 {
        let reimburse = (chunk_count as u64)
            .checked_mul(base_tx_fee)
            .ok_or(error!(JobsError::Overflow))?;
        // Escrow must exceed TX reimbursement (positive margin required)
        require!(escrow_amount > reimburse, JobsError::EscrowTooLow);
        reimburse
    } else {
        0u64
    };

    let job = &mut ctx.accounts.job;
    job.job_id = job_id;
    job.creator = ctx.accounts.creator.key();
    job.writer = Pubkey::default();
    job.content_hash = content_hash;
    job.chunk_count = chunk_count;
    job.escrow_lamports = escrow_amount;
    job.status = JobStatus::Open;
    job.created_at = now;
    job.claimed_at = 0;
    job.submitted_at = 0;
    job.completed_at = 0;
    job.attestation_count = 0;
    job.pointer_sig = String::new();
    job.bump = ctx.bumps.job;
    job.referrer = referrer;
    job.assigned_node = assigned_node;
    job.exclusive_until = exclusive_until;
    job.blob_source = blob_source;
    job.tx_reimbursement_lamports = tx_reimbursement;

    // Snapshot fee BPS — locked at creation so fees can't change mid-flight
    job.snap_inscriber_bps = config.inscriber_fee_bps;
    job.snap_indexer_bps = config.indexer_fee_bps;
    job.snap_treasury_bps = config.treasury_fee_bps;
    job.snap_referral_bps = config.referral_fee_bps;

    Ok(())
}
