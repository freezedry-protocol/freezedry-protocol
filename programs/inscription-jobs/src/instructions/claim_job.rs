use anchor_lang::prelude::*;
use crate::state::{Config, JobAccount, JobStatus};
use crate::error::JobsError;

/// Stake info extracted from a NodeAccount's raw bytes
pub struct NodeStakeInfo {
    pub verified_stake: u64,
    pub stake_voter: Pubkey,
    pub stake_verified_at: i64,
}

#[derive(Accounts)]
pub struct ClaimJob<'info> {
    #[account(
        mut,
        seeds = [b"fd-job", job.job_id.to_le_bytes().as_ref()],
        bump = job.bump,
        constraint = job.status == JobStatus::Open @ JobsError::InvalidJobStatus,
    )]
    pub job: Account<'info, JobAccount>,

    #[account(
        seeds = [b"fd-config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Writer's NodeAccount from the registry program.
    /// Manually verified: owner == registry_program, discriminator, wallet, role, is_active, stake fields.
    pub node_account: AccountInfo<'info>,

    /// CHECK: RegistryConfig PDA from the registry program.
    /// Manually verified: owner == registry_program, PDA derivation, discriminator.
    /// Contains preferred_validator for Tier 1 determination.
    pub registry_config: AccountInfo<'info>,

    #[account(mut)]
    pub writer: Signer<'info>,
}

pub fn claim_job(ctx: Context<ClaimJob>) -> Result<()> {
    let registry_program = &ctx.accounts.config.registry_program;
    let writer_key = ctx.accounts.writer.key();
    let node_info = &ctx.accounts.node_account;

    // Verify the NodeAccount and read stake info
    let stake_info = verify_node_account(node_info, &writer_key, &[1, 2], registry_program)?;

    // Read preferred_validator from RegistryConfig PDA
    let preferred_validator = verify_registry_config(
        &ctx.accounts.registry_config,
        registry_program,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;

    // Exclusive window: only assigned_node can claim until exclusive_until
    if job.assigned_node != Pubkey::default()
        && now < job.exclusive_until
        && writer_key != job.assigned_node
    {
        return err!(JobsError::ExclusiveWindowActive);
    }

    // Assigned node skips stake delay (exclusive window handles priority)
    let skip_stake_delay = job.assigned_node != Pubkey::default()
        && writer_key == job.assigned_node;

    if !skip_stake_delay {
        // Read stake delay params from config._reserved[0..6]
        // [0..2] unstaked_claim_delay (u16, seconds)
        // [2..4] tier2_max_delay (u16, seconds)
        // [4..6] tier2_zero_stake_sol (u16, SOL units — multiply by 1e9 for lamports)
        let reserved = &ctx.accounts.config._reserved;
        let unstaked_delay = u16::from_le_bytes([reserved[0], reserved[1]]) as i64;
        let tier2_max_delay = u16::from_le_bytes([reserved[2], reserved[3]]) as i64;
        let tier2_zero_sol = u16::from_le_bytes([reserved[4], reserved[5]]) as u64;

        // Only enforce if delays are configured (0 = disabled, backward compat)
        if unstaked_delay > 0 {
            // Stake freshness: verification older than 7 days = treated as unstaked
            let stake_fresh = stake_info.stake_verified_at > 0
                && (now - stake_info.stake_verified_at) < 604_800; // 7 days

            let is_staked = stake_fresh && stake_info.verified_stake > 0;
            let is_preferred = is_staked
                && stake_info.stake_voter == preferred_validator
                && preferred_validator != Pubkey::default();

            if is_preferred {
                // Tier 1: staked to preferred validator — instant claim (0 delay)
            } else if is_staked && tier2_max_delay > 0 {
                // Tier 2: staked to any validator — delay scales inversely with stake
                let zero_at_lamports = tier2_zero_sol.saturating_mul(1_000_000_000);
                let delay = if zero_at_lamports == 0 || stake_info.verified_stake >= zero_at_lamports {
                    0i64
                } else {
                    // Linear interpolation: more stake = less delay
                    let ratio = stake_info.verified_stake as i128 * 10000 / zero_at_lamports as i128;
                    let remaining = 10000i128 - ratio;
                    (tier2_max_delay as i128 * remaining / 10000) as i64
                };
                if delay > 0 {
                    require!(
                        now >= job.created_at + delay,
                        JobsError::StakeDelayNotElapsed
                    );
                }
            } else {
                // Tier 3: unstaked — must wait full unstaked_claim_delay
                require!(
                    now >= job.created_at + unstaked_delay,
                    JobsError::StakeDelayNotElapsed
                );
            }
        }
    }

    job.writer = writer_key;
    job.status = JobStatus::Claimed;
    job.claimed_at = now;

    Ok(())
}

/// Manually deserialize and verify a NodeAccount from the registry program.
/// Avoids CPI — reads raw account data instead.
/// Returns stake info for tiering decisions.
///
/// NodeAccount layout (after 8-byte discriminator):
///   [8..40]   wallet (32 bytes)
///   [40..44]  node_id length (u32 LE)
///   [44..+]   node_id bytes
///   [+4]      url length (u32 LE)
///   [+len]    url bytes
///   [+1]      role (0=Reader, 1=Writer, 2=Both)
///   [+8]      registered_at (i64)
///   [+8]      last_heartbeat (i64)
///   [+1]      is_active (bool)
///   [+8]      artworks_indexed (u64)
///   [+8]      artworks_complete (u64)
///   [+1]      bump (u8)
///   [+8]      verified_stake (u64)
///   [+32]     stake_voter (Pubkey)
///   [+8]      stake_verified_at (i64)
pub fn verify_node_account(
    node_info: &AccountInfo,
    expected_wallet: &Pubkey,
    required_roles: &[u8],
    registry_program: &Pubkey,
) -> Result<NodeStakeInfo> {
    // 1. Account must be owned by the registry program
    require!(
        node_info.owner == registry_program,
        JobsError::InvalidNodeAccount
    );

    // 2. Verify PDA derivation: ["freeze-node", wallet]
    let (expected_pda, _) = Pubkey::find_program_address(
        &[b"freeze-node", expected_wallet.as_ref()],
        registry_program,
    );
    require!(
        node_info.key() == expected_pda,
        JobsError::InvalidNodeAccount
    );

    let data = node_info.try_borrow_data()?;
    require!(data.len() >= 50, JobsError::InvalidNodeAccount);

    // 3. Check discriminator (NodeAccount from freezedry_registry IDL)
    let expected_disc: [u8; 8] = [125, 166, 18, 146, 195, 127, 86, 220];
    require!(data[..8] == expected_disc, JobsError::InvalidNodeAccount);

    // 4. Read wallet (bytes 8..40) and verify
    let wallet_bytes: [u8; 32] = data[8..40]
        .try_into()
        .map_err(|_| error!(JobsError::InvalidNodeAccount))?;
    let wallet = Pubkey::new_from_array(wallet_bytes);
    require!(wallet == *expected_wallet, JobsError::NodeWalletMismatch);

    // 5. Skip node_id string (4-byte len prefix + content)
    let mut offset: usize = 40;
    require!(
        data.len() >= offset + 4,
        JobsError::InvalidNodeAccount
    );
    let node_id_len = u32::from_le_bytes(
        data[offset..offset + 4]
            .try_into()
            .map_err(|_| error!(JobsError::InvalidNodeAccount))?,
    ) as usize;
    offset += 4 + node_id_len;

    // 6. Skip url string (4-byte len prefix + content)
    require!(
        data.len() >= offset + 4,
        JobsError::InvalidNodeAccount
    );
    let url_len = u32::from_le_bytes(
        data[offset..offset + 4]
            .try_into()
            .map_err(|_| error!(JobsError::InvalidNodeAccount))?,
    ) as usize;
    offset += 4 + url_len;

    // 7. Read role (1 byte): 0=Reader, 1=Writer, 2=Both
    require!(data.len() > offset, JobsError::InvalidNodeAccount);
    let role = data[offset];
    require!(
        required_roles.contains(&role),
        JobsError::InvalidNodeRole
    );
    offset += 1;

    // 8. Skip registered_at (8 bytes) + last_heartbeat (8 bytes)
    offset += 16;

    // 9. Read is_active (1 byte)
    require!(data.len() > offset, JobsError::InvalidNodeAccount);
    let is_active = data[offset] == 1;
    require!(is_active, JobsError::NodeNotActive);
    offset += 1;

    // 10. Skip artworks_indexed (8) + artworks_complete (8) + bump (1)
    offset += 17;

    // 11. Read verified_stake (u64, 8 bytes) — 0 = unverified
    let verified_stake = if data.len() >= offset + 8 {
        u64::from_le_bytes(
            data[offset..offset + 8]
                .try_into()
                .map_err(|_| error!(JobsError::InvalidNodeAccount))?,
        )
    } else {
        0u64 // Old NodeAccount without stake fields — treat as unstaked
    };
    offset += 8;

    // 12. Read stake_voter (Pubkey, 32 bytes)
    let stake_voter = if data.len() >= offset + 32 {
        let bytes: [u8; 32] = data[offset..offset + 32]
            .try_into()
            .map_err(|_| error!(JobsError::InvalidNodeAccount))?;
        Pubkey::new_from_array(bytes)
    } else {
        Pubkey::default()
    };
    offset += 32;

    // 13. Read stake_verified_at (i64, 8 bytes)
    let stake_verified_at = if data.len() >= offset + 8 {
        i64::from_le_bytes(
            data[offset..offset + 8]
                .try_into()
                .map_err(|_| error!(JobsError::InvalidNodeAccount))?,
        )
    } else {
        0i64
    };

    Ok(NodeStakeInfo {
        verified_stake,
        stake_voter,
        stake_verified_at,
    })
}

/// Verify and read RegistryConfig PDA from the registry program.
/// Returns the preferred_validator pubkey.
///
/// RegistryConfig layout (after 8-byte discriminator):
///   [8..40]   authority (Pubkey, 32 bytes)
///   [40..72]  preferred_validator (Pubkey, 32 bytes)
///   [72]      bump (u8)
///   [73..137] _reserved (64 bytes)
pub fn verify_registry_config(
    config_info: &AccountInfo,
    registry_program: &Pubkey,
) -> Result<Pubkey> {
    // 1. Account must be owned by the registry program
    require!(
        config_info.owner == registry_program,
        JobsError::InvalidRegistryConfig
    );

    // 2. Verify PDA derivation: ["fd-registry-config"]
    let (expected_pda, _) = Pubkey::find_program_address(
        &[b"fd-registry-config"],
        registry_program,
    );
    require!(
        config_info.key() == expected_pda,
        JobsError::InvalidRegistryConfig
    );

    let data = config_info.try_borrow_data()?;
    require!(data.len() >= 73, JobsError::InvalidRegistryConfig);

    // 3. Check discriminator (RegistryConfig from freezedry_registry IDL)
    // sha256("account:RegistryConfig")[..8]
    let expected_disc: [u8; 8] = [23, 118, 10, 246, 173, 231, 243, 156];
    require!(data[..8] == expected_disc, JobsError::InvalidRegistryConfig);

    // 4. Read preferred_validator (bytes 40..72)
    let pv_bytes: [u8; 32] = data[40..72]
        .try_into()
        .map_err(|_| error!(JobsError::InvalidRegistryConfig))?;

    Ok(Pubkey::new_from_array(pv_bytes))
}
