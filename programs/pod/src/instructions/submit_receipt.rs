use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use crate::state::{PodConfig, NodeEpochAccount};
use crate::error::PodError;

/// Ed25519 precompile program ID: Ed25519SigVerify111111111111111111111111111
const ED25519_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    3, 125, 70, 214, 124, 147, 251, 190,
    18, 249, 66, 143, 131, 141, 64, 255,
    5, 112, 116, 73, 39, 244, 138, 100,
    252, 202, 112, 68, 128, 0, 0, 0,
]);

/// Signed message size: 1 + 8 + 4 + 32 + 32 + 8 + 8 = 93 bytes
const MESSAGE_SIZE: usize = 93;

/// Expected message version
const MESSAGE_VERSION: u8 = 1;

#[derive(Accounts)]
#[instruction(nonce: u64, epoch: u32)]
pub struct SubmitReceipt<'info> {
    #[account(
        seeds = [b"fd-pod-config"],
        bump = config.bump,
    )]
    pub config: Account<'info, PodConfig>,

    #[account(
        init_if_needed,
        payer = node,
        space = 8 + NodeEpochAccount::INIT_SPACE,
        seeds = [b"fd-pod-node-epoch", epoch.to_le_bytes().as_ref(), node.key().as_ref()],
        bump,
    )]
    pub node_epoch: Account<'info, NodeEpochAccount>,

    #[account(mut)]
    pub node: Signer<'info>,

    /// CHECK: Instructions sysvar for Ed25519 precompile introspection
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn submit_receipt(
    ctx: Context<SubmitReceipt>,
    nonce: u64,
    epoch: u32,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let node_key = ctx.accounts.node.key();
    let ix_sysvar = &ctx.accounts.instruction_sysvar;

    // ── Ed25519 precompile introspection (13 security checks) ──────────

    // 1. Load current instruction index
    let current_ix = load_current_index_checked(ix_sysvar)
        .map_err(|_| error!(PodError::MissingEd25519Instruction))?;

    // 2. The Ed25519 precompile must be the immediately preceding instruction
    require!(current_ix >= 1, PodError::MissingEd25519Instruction);
    let ed25519_ix = load_instruction_at_checked((current_ix - 1) as usize, ix_sysvar)
        .map_err(|_| error!(PodError::MissingEd25519Instruction))?;

    // 3. Verify program ID is the Ed25519 precompile
    require!(
        ed25519_ix.program_id == ED25519_PROGRAM_ID,
        PodError::InvalidEd25519Program
    );

    // 4. Precompile takes zero accounts
    require!(
        ed25519_ix.accounts.is_empty(),
        PodError::InvalidEd25519Accounts
    );

    let data = &ed25519_ix.data;

    // Ed25519 precompile data layout (for 1 signature, 93-byte message):
    // [0]     num_signatures (u8) = 1
    // [1]     padding (u8) = 0
    // [2..4]  signature_offset (u16 LE)
    // [4..6]  signature_instruction_index (u16 LE) = 0xFFFF
    // [6..8]  public_key_offset (u16 LE)
    // [8..10] public_key_instruction_index (u16 LE) = 0xFFFF
    // [10..12] message_data_offset (u16 LE)
    // [12..14] message_data_size (u16 LE)
    // [14..16] message_instruction_index (u16 LE) = 0xFFFF
    // [16..48] public key (32 bytes)
    // [48..112] signature (64 bytes)
    // [112..205] message (93 bytes)

    // Minimum data length: 16 header + 32 pubkey + 64 sig + 93 msg = 205
    require!(data.len() >= 16 + 32 + 64 + MESSAGE_SIZE, PodError::MalformedMessage);

    // 5. Exactly one signature
    require!(data[0] == 1, PodError::InvalidSignatureCount);

    // 6. All three instruction_index fields must be 0xFFFF (data inline)
    let sig_ix_index = u16::from_le_bytes([data[4], data[5]]);
    let pk_ix_index = u16::from_le_bytes([data[8], data[9]]);
    let msg_ix_index = u16::from_le_bytes([data[14], data[15]]);
    require!(
        sig_ix_index == 0xFFFF && pk_ix_index == 0xFFFF && msg_ix_index == 0xFFFF,
        PodError::InvalidInstructionIndices
    );

    // 7. Extract pubkey from precompile data and verify against config
    let pubkey_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    require!(pubkey_offset + 32 <= data.len(), PodError::MalformedMessage);
    let ed25519_pubkey = &data[pubkey_offset..pubkey_offset + 32];
    require!(
        ed25519_pubkey == config.cdn_pubkey.as_ref(),
        PodError::CdnPubkeyMismatch
    );

    // Extract message from precompile data
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    require!(msg_size == MESSAGE_SIZE, PodError::MalformedMessage);
    require!(msg_offset + msg_size <= data.len(), PodError::MalformedMessage);
    let msg = &data[msg_offset..msg_offset + msg_size];

    // ── Parse the 93-byte signed message ───────────────────────────────
    // [0]      version (u8)
    // [1..9]   nonce (u64 LE)
    // [9..13]  epoch (u32 LE)
    // [13..45] node_wallet (Pubkey, 32 bytes)
    // [45..77] content_hash (SHA-256, 32 bytes)
    // [77..85] bytes_served (u64 LE)
    // [85..93] timestamp (i64 LE, unix ms)

    // 8. Message version must be 1
    require!(msg[0] == MESSAGE_VERSION, PodError::UnsupportedVersion);

    // 9. Message nonce must match instruction arg
    let msg_nonce = u64::from_le_bytes(msg[1..9].try_into().unwrap());
    require!(msg_nonce == nonce, PodError::NonceMismatch);

    // 10. Message epoch must match instruction arg
    let msg_epoch = u32::from_le_bytes(msg[9..13].try_into().unwrap());
    require!(msg_epoch == epoch, PodError::EpochMismatch);

    // 11. Message node_wallet must match the submitting node signer
    let msg_node_wallet = Pubkey::try_from(&msg[13..45]).unwrap();
    require!(msg_node_wallet == node_key, PodError::NodeWalletMismatch);

    // Extract remaining fields
    let bytes_served = u64::from_le_bytes(msg[77..85].try_into().unwrap());
    let timestamp = i64::from_le_bytes(msg[85..93].try_into().unwrap());

    // 12. Receipt must not be expired (timestamp within max_receipt_age of current time)
    let clock = Clock::get()?;
    let now_ms = clock.unix_timestamp * 1000; // convert to ms for comparison
    let age_ms = now_ms.saturating_sub(timestamp).unsigned_abs();
    let max_age_ms = (config.max_receipt_age as u64) * 1000;
    require!(age_ms <= max_age_ms, PodError::ReceiptExpired);

    // 13. NodeEpochAccount must not be finalized
    let node_epoch = &mut ctx.accounts.node_epoch;
    require!(!node_epoch.finalized, PodError::EpochFinalized);

    // 14. Nonce-based replay protection: nonce must be strictly greater than last seen
    require!(nonce > node_epoch.last_nonce, PodError::NonceAlreadyUsed);

    // ── Update NodeEpochAccount (init_if_needed handles first-time creation) ──

    if node_epoch.delivery_count == 0 {
        // First receipt for this node+epoch — initialize fields
        node_epoch.epoch = epoch;
        node_epoch.node_wallet = node_key;
        node_epoch.first_receipt_at = timestamp;
        node_epoch.last_receipt_at = timestamp;
        node_epoch.last_nonce = 0;
        node_epoch.bump = ctx.bumps.node_epoch;
        node_epoch._reserved = [0u8; 24];
    }

    node_epoch.last_nonce = nonce;
    node_epoch.delivery_count = node_epoch
        .delivery_count
        .checked_add(1)
        .ok_or(error!(PodError::Overflow))?;
    node_epoch.bytes_total = node_epoch
        .bytes_total
        .checked_add(bytes_served)
        .ok_or(error!(PodError::Overflow))?;
    // unique_hashes tracking is approximate — we just increment for now
    // (exact tracking would require a set/bloom filter, overkill on-chain)
    node_epoch.unique_hashes = node_epoch
        .unique_hashes
        .checked_add(1)
        .ok_or(error!(PodError::Overflow))?;
    node_epoch.last_receipt_at = timestamp;

    msg!(
        "POD receipt: nonce={}, epoch={}, node={}, bytes={}",
        nonce,
        epoch,
        node_key,
        bytes_served
    );

    Ok(())
}
