use anchor_lang::prelude::*;
use std::mem::size_of; // Optional if you want to compute sizes dynamically

/// The global game state, storing high-level config and status.
#[account]
#[derive(Default, InitSpace)]
pub struct Game {
    pub game_id: u64,           // Unique identifier for the game instance
    pub authority: Pubkey,      // Authority that controls the game
    pub token_mint: Pubkey,     // (Optional) Token mint used in the game
    pub rewards_vault: Pubkey,  // (Optional) Vault that holds staking rewards
    pub map_diameter: u32,      // Diameter of the circular map
    pub battle_range: u32,      // Max range for battle interactions
    pub is_active: bool,        // Whether the game is currently active
    pub last_update: i64,       // Timestamp of last game state update
    pub reentrancy_guard: bool, // Guard against reentrancy attacks
    pub bump: u8,               // PDA bump seed
    #[max_len(5)]              // Maximum number of alliances (adjust as needed)
    pub alliances: Vec<Alliance>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct Alliance {
    pub agent1: Pubkey,      // The pubkey of agent #1
    pub agent2: Pubkey,      // The pubkey of agent #2
    pub formed_at: i64,      // Timestamp when the alliance was formed
    pub is_active: bool,     // Whether the alliance is currently active
}

// Implement the Space trait for Alliance so Anchor can calculate its on-chain size.
// In your version, the required associated constant is `INIT_SPACE`.
impl Space for Alliance {
    // You can compute the size using either literals or `size_of` from std::mem.
    // Two Pubkeys (32 bytes each) + one i64 (8 bytes) + one bool (1 byte) = 32 + 32 + 8 + 1 = 73 bytes.
    const INIT_SPACE: usize = 32 + 32 + 8 + 1;
    // Alternatively, you could write:
    // const INIT_SPACE: usize = (size_of::<Pubkey>() * 2) + size_of::<i64>() + size_of::<bool>();
}
