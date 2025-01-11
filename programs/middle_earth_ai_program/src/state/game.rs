use anchor_lang::prelude::*;

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
}
