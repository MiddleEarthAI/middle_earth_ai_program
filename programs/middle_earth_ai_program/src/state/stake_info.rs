use anchor_lang::prelude::*;

/// A per‑staker record for deposits (staked tokens) and issued shares.
#[account]
#[derive(Default)]
pub struct StakeInfo {
    /// The Agent (vault) this stake is associated with.
    pub agent: Pubkey,
    /// The staker’s public key.
    pub staker: Pubkey,
    /// The amount of tokens the user has deposited.
    pub amount: u64,
    /// The number of shares the user holds.
    pub shares: u64,
    /// The last time (Unix timestamp) this staker claimed rewards.
    pub last_reward_timestamp: i64,
    /// Bump value for the PDA.
    pub bump: u8,
    pub cooldown_ends_at: i64,

}

impl StakeInfo {
    // This is the extra space required (not including the 8-byte discriminator).
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 + 8 + 1;
}

