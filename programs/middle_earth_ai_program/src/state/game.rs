use anchor_lang::prelude::*;

#[account]
#[derive(Default, InitSpace)]
pub struct Game {
    pub game_id: u64,           // Unique identifier for the game instance
    pub authority: Pubkey,      // Authority that controls the game
    pub token_mint: Pubkey,     // Token mint used in the game
    pub rewards_vault: Pubkey,  // Vault that holds staking rewards
    pub map_diameter: u32,      // Diameter of the circular map
    pub battle_range: u32,      // Maximum range for battle interactions
    pub is_active: bool,        // Whether the game is currently active
    pub last_update: i64,       // Timestamp of last game state update
    pub reentrancy_guard: bool, // Guard against reentrancy
    pub bump: u8,               // PDA bump seed
}
