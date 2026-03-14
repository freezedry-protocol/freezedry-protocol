use anchor_lang::prelude::*;

pub mod state;
pub mod error;
pub mod instructions;

use instructions::*;

declare_id!("AmqBYKYCqpmKoFcgvripCQ3bJC2d8ygWWhcoHtmTvvzx");

#[program]
pub mod freezedry_jobs {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        treasury: Pubkey,
        registry_program: Pubkey,
        inscriber_fee_bps: u16,
        indexer_fee_bps: u16,
        treasury_fee_bps: u16,
        referral_fee_bps: u16,
        min_attestations: u8,
        job_expiry_seconds: i64,
        min_escrow_lamports: u64,
    ) -> Result<()> {
        instructions::initialize::initialize(
            ctx,
            treasury,
            registry_program,
            inscriber_fee_bps,
            indexer_fee_bps,
            treasury_fee_bps,
            referral_fee_bps,
            min_attestations,
            job_expiry_seconds,
            min_escrow_lamports,
        )
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        treasury: Option<Pubkey>,
        inscriber_fee_bps: Option<u16>,
        indexer_fee_bps: Option<u16>,
        treasury_fee_bps: Option<u16>,
        referral_fee_bps: Option<u16>,
        min_attestations: Option<u8>,
        job_expiry_seconds: Option<i64>,
        min_escrow_lamports: Option<u64>,
        default_exclusive_window: Option<u32>,
        max_exclusive_window: Option<u32>,
        base_tx_fee_lamports: Option<u64>,
    ) -> Result<()> {
        instructions::update_config::update_config(
            ctx,
            treasury,
            inscriber_fee_bps,
            indexer_fee_bps,
            treasury_fee_bps,
            referral_fee_bps,
            min_attestations,
            job_expiry_seconds,
            min_escrow_lamports,
            default_exclusive_window,
            max_exclusive_window,
            base_tx_fee_lamports,
        )
    }

    pub fn close_config(ctx: Context<CloseConfig>) -> Result<()> {
        instructions::close_config::close_config(ctx)
    }

    pub fn admin_close_job(ctx: Context<AdminCloseJob>) -> Result<()> {
        instructions::admin_close_job::admin_close_job(ctx)
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
        instructions::create_job::create_job(ctx, content_hash, chunk_count, escrow_amount, referrer, assigned_node, exclusive_window, blob_source)
    }

    pub fn claim_job(ctx: Context<ClaimJob>) -> Result<()> {
        instructions::claim_job::claim_job(ctx)
    }

    pub fn submit_receipt(
        ctx: Context<SubmitReceipt>,
        pointer_sig: String,
    ) -> Result<()> {
        instructions::submit_receipt::submit_receipt(ctx, pointer_sig)
    }

    pub fn attest(ctx: Context<Attest>, computed_hash: String) -> Result<()> {
        instructions::attest::attest(ctx, computed_hash)
    }

    pub fn release_payment(ctx: Context<ReleasePayment>) -> Result<()> {
        instructions::release_payment::release_payment(ctx)
    }

    pub fn close_attestation(ctx: Context<CloseAttestation>, job_id: u64) -> Result<()> {
        instructions::close_attestation::close_attestation(ctx, job_id)
    }

    pub fn admin_close_attestation(ctx: Context<AdminCloseAttestation>) -> Result<()> {
        instructions::admin_close_attestation::admin_close_attestation(ctx)
    }

    pub fn cancel_job(ctx: Context<CancelJob>) -> Result<()> {
        instructions::cancel_job::cancel_job(ctx)
    }

    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        instructions::refund_expired::refund_expired(ctx)
    }

    pub fn requeue_expired(ctx: Context<RequeueExpired>) -> Result<()> {
        instructions::requeue_expired::requeue_expired(ctx)
    }

    pub fn close_completed_job(ctx: Context<CloseCompletedJob>) -> Result<()> {
        instructions::close_completed_job::close_completed_job(ctx)
    }

    pub fn register_referrer(ctx: Context<RegisterReferrer>, name: String) -> Result<()> {
        instructions::register_referrer::register_referrer(ctx, name)
    }

    pub fn close_referrer(ctx: Context<CloseReferrer>) -> Result<()> {
        instructions::close_referrer::close_referrer(ctx)
    }

    pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::transfer_authority::transfer_authority(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::transfer_authority::accept_authority(ctx)
    }
}
