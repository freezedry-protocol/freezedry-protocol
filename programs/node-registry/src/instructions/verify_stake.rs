use anchor_lang::prelude::*;
use crate::state::NodeAccount;
use crate::error::RegistryError;

/// Native Solana Stake Program ID: Stake11111111111111111111111111111111111111
const STAKE_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    6, 161, 216, 23, 145, 55, 84, 42,
    152, 52, 55, 189, 254, 42, 122, 178,
    85, 127, 83, 92, 138, 120, 114, 43,
    104, 164, 157, 192, 0, 0, 0, 0,
]);

/// Verify a node operator's Solana Stake Account delegation.
///
/// Manual byte deserialization of the native Stake Account layout:
///   [0..4]    discriminant (u32 LE) — must be 2 (StakeState::Stake)
///   [4..12]   rent_exempt_reserve (u64 LE)
///   [12..44]  meta.authorized.staker (Pubkey)
///   [44..76]  meta.authorized.withdrawer (Pubkey)
///   [76..84]  meta.lockup.unix_timestamp (i64 LE)
///   [84..92]  meta.lockup.epoch (u64 LE)
///   [92..124] meta.lockup.custodian (Pubkey)
///   [124..156] delegation.voter_pubkey (Pubkey)
///   [156..164] delegation.stake (u64 LE)
///   [164..172] delegation.activation_epoch (u64 LE)
///   [172..180] delegation.deactivation_epoch (u64 LE)
///
/// No new crate dependencies — same manual parsing as claim_job.rs NodeAccount verification.

#[derive(Accounts)]
pub struct VerifyStake<'info> {
    #[account(
        mut,
        seeds = [b"freeze-node", owner.key().as_ref()],
        bump = node.bump,
        constraint = node.wallet == owner.key() @ RegistryError::Unauthorized,
    )]
    pub node: Account<'info, NodeAccount>,

    /// CHECK: Validated manually — must be owned by the native Stake Program
    pub stake_account: AccountInfo<'info>,

    /// Node operator — must match node.wallet
    pub owner: Signer<'info>,
}

pub fn verify_stake(ctx: Context<VerifyStake>) -> Result<()> {
    let stake_info = &ctx.accounts.stake_account;
    let owner_key = ctx.accounts.owner.key();

    // 1. Must be owned by the native Stake Program
    require!(
        *stake_info.owner == STAKE_PROGRAM_ID,
        RegistryError::InvalidStakeOwner
    );

    let data = stake_info.try_borrow_data()?;

    // 2. Must be at least 180 bytes (full StakeState::Stake layout)
    require!(data.len() >= 180, RegistryError::StakeDataTooSmall);

    // 3. Discriminant must be 2 (StakeState::Stake — actively delegated)
    let disc = u32::from_le_bytes(data[0..4].try_into().unwrap());
    require!(disc == 2, RegistryError::StakeNotDelegated);

    // 4. Staker or withdrawer must match the node owner
    let staker = Pubkey::try_from(&data[12..44]).unwrap();
    let withdrawer = Pubkey::try_from(&data[44..76]).unwrap();
    require!(
        staker == owner_key || withdrawer == owner_key,
        RegistryError::StakeOwnershipMismatch
    );

    // 5. Read delegation fields
    let voter_pubkey = Pubkey::try_from(&data[124..156]).unwrap();
    let stake_lamports = u64::from_le_bytes(data[156..164].try_into().unwrap());
    let deactivation_epoch = u64::from_le_bytes(data[172..180].try_into().unwrap());

    // 6. Delegation must have nonzero stake
    require!(stake_lamports > 0, RegistryError::ZeroStake);

    // 7. Must not be deactivating (deactivation_epoch == u64::MAX means active)
    require!(
        deactivation_epoch == u64::MAX,
        RegistryError::StakeDeactivating
    );

    // 8. Write verified fields into the NodeAccount PDA
    let node = &mut ctx.accounts.node;
    node.verified_stake = stake_lamports;
    node.stake_voter = voter_pubkey;
    node.stake_verified_at = Clock::get()?.unix_timestamp;

    msg!(
        "Stake verified: {} lamports delegated to {}",
        stake_lamports,
        voter_pubkey
    );

    Ok(())
}
