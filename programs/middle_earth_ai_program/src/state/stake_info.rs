use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct StakeInfo {
    /// The Agent (vault) this stake is associated with.
    pub agent: Pubkey,                  // 32 bytes
    /// The staker’s public key.
    pub staker: Pubkey,                 // 32 bytes
    /// The amount of tokens the user has deposited.
    pub amount: u64,                    // 8 bytes
    /// The number of shares the user holds.
    pub shares: u128,                   // 16 bytes
    /// The last time (Unix timestamp) this staker claimed rewards.
    pub last_reward_timestamp: i64,     // 8 bytes
    /// The Unix timestamp when the cooldown ends.
    pub cooldown_ends_at: i64,          // 8 bytes
    /// Indicates whether the stake_info account has been initialized.
    pub is_initialized: bool,           // 1 byte
    /// Padding to align to 8 bytes
    pub __padding: [u8; 7],             // 7 bytes
}

impl StakeInfo {
    // Correct INIT_SPACE: 32 + 32 + 8 + 16 + 8 + 8 + 1 + 7 = 112 bytes
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 16 + 8 + 8 + 1 + 7;
}
