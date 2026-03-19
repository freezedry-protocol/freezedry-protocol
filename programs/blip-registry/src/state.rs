use anchor_lang::prelude::*;

/// Validates username: 3-20 chars, lowercase alphanumeric + underscore only.
pub fn is_valid_username(username: &str) -> bool {
    let len = username.len();
    if len < 3 || len > 20 {
        return false;
    }
    username.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// On-chain account mapping a wallet to its registered username.
/// PDA seeds: ["blip-user", wallet.key()]
#[account]
#[derive(InitSpace)]
pub struct UserAccount {
    /// The wallet that owns this registration
    pub wallet: Pubkey,

    /// The registered username (3-20 chars, lowercase alphanumeric + underscore)
    #[max_len(20)]
    pub username: String,

    /// Unix timestamp when registered
    pub registered_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

/// On-chain account mapping a username to its wallet.
/// PDA seeds: ["blip-name", username.as_bytes()]
/// Enables reverse lookup: username → wallet.
#[account]
#[derive(InitSpace)]
pub struct UsernameAccount {
    /// The wallet that owns this username
    pub wallet: Pubkey,

    /// PDA bump seed
    pub bump: u8,
}
