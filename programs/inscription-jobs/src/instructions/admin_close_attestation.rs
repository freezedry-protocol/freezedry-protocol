use anchor_lang::prelude::*;
use crate::state::{Config, VerificationAttestation};
use crate::error::JobsError;

#[derive(Accounts)]
pub struct AdminCloseAttestation<'info> {
    #[account(
        seeds = [b"fd-config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ JobsError::NotCreator,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        close = authority,
        seeds = [b"fd-attest", attestation.job_id.to_le_bytes().as_ref(), attestation.reader.as_ref()],
        bump = attestation.bump,
    )]
    pub attestation: Account<'info, VerificationAttestation>,

    /// Authority must sign — only admin can force-close orphaned attestations
    #[account(mut)]
    pub authority: Signer<'info>,
}

/// Authority force-closes any attestation PDA — for cleanup of orphaned attestations
/// when the Job PDA has already been closed. Rent returns to authority.
pub fn admin_close_attestation(_ctx: Context<AdminCloseAttestation>) -> Result<()> {
    msg!("Attestation PDA force-closed by authority — rent returned to authority");
    Ok(())
}
