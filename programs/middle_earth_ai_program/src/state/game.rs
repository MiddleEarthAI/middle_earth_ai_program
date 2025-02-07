use anchor_lang::prelude::*;
use crate::state::agent_info::AgentInfo;

#[account]
#[derive(Default, InitSpace)]
pub struct Game {
    pub game_id: u64,           // Unique identifier for the game instance
    pub authority: Pubkey,      // Authority that controls the game
    pub token_mint: Pubkey,     // (Optional) Token mint used in the game
    pub rewards_vault: Pubkey,  // (Optional) Vault that holds staking rewards
    pub map_diameter: u32,      // Diameter of the circular map
    pub is_active: bool,        // Whether the game is currently active
    pub last_update: i64,       // Timestamp of last game state update
    pub bump: u8,               // PDA bump seed
    pub daily_reward_tokens: u64, // Number of tokens to distribute daily
    #[max_len(5)]
    pub alliances: Vec<Alliance>, 

    #[max_len(4)]
    pub agents: Vec<AgentInfo>,

    // ---------------------------
    // NEW: Track total stake per staker across all agents
    // ---------------------------
    #[max_len(64)] // example max length, adjust as needed
    pub total_stake_accounts: Vec<StakerStake>,
}

// Helper struct for the global "per-account stake total."
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct StakerStake {
    pub staker: Pubkey,
    pub total_stake: u64,
}

// Implement the `Space` trait for `StakerStake`.
// Pubkey is 32 bytes and u64 is 8 bytes.
impl Space for StakerStake {
    const INIT_SPACE: usize = 32 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Alliance {
    pub agent1: Pubkey,  
    pub agent2: Pubkey,  
    pub formed_at: i64,  
    pub is_active: bool, 
}

impl Space for Alliance {
    // 32 + 32 + 8 + 1 = 73 bytes
    const INIT_SPACE: usize = 73;
}

// ---------------------------
// Example of an updated StakeInfo (if defined here or re-exported via stake_info module)
// ---------------------------
