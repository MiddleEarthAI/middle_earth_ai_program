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
    pub reentrancy_guard: bool, // Guard against reentrancy attacks
    pub bump: u8,               // PDA bump seed
    #[max_len(5)]              // Existing alliances with a maximum length.
    pub alliances: Vec<Alliance>,
    #[max_len(4)]              // New global list of agents. Limit to 4.
    pub agents: Vec<AgentInfo>,
}

// The Alliance struct remains the same.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Alliance {
    pub agent1: Pubkey,  // The pubkey of agent #1
    pub agent2: Pubkey,  // The pubkey of agent #2
    pub formed_at: i64,  // Timestamp when the alliance was formed
    pub is_active: bool, // Whether the alliance is currently active
}

impl Space for Alliance {
    // Two Pubkeys (32 bytes each) + one i64 (8 bytes) + one bool (1 byte) = 73 bytes.
    const INIT_SPACE: usize = 32 + 32 + 8 + 1;
}
