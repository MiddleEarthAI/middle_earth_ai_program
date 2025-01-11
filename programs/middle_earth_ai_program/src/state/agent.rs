use anchor_lang::prelude::*;
use crate::constants::*;
use crate::error::GameError;

// Example enumeration for different terrain types
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum TerrainType {
    Plain,
    Mountain,
    River,
}

// Enumeration for causes of death
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq)]
pub enum DeathCause {
    Battle,
    Terrain,
}

// Tracks cooldown for ignoring an agent
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub struct IgnoreCooldown {
    pub agent_id: u8,   
    pub timestamp: i64, 
}

#[account]
#[derive(Default, InitSpace)]
pub struct Agent {
    // Basic references
    pub game: Pubkey,                  // The Game this Agent belongs to
    pub authority: Pubkey,             // Who can control this Agent
    pub id: u8,                        // Unique Agent ID
    
    // Position and state
    pub x: i32,                        // X coordinate
    pub y: i32,                        // Y coordinate
    pub is_alive: bool,                // Whether Agent is alive
    pub last_move: i64,                // Timestamp of last movement
    pub last_battle: i64,              // Timestamp of last battle
    pub current_battle_start: Option<i64>, 
    
    // Alliance/ignore info
    pub alliance_with: Option<u8>,     // ID of agent allied with
    pub alliance_timestamp: i64,       // When alliance was formed
    #[max_len(32)]
    pub ignore_cooldowns: Vec<IgnoreCooldown>, // Agents being ignored
    
    // Token/staking info
    pub token_balance: u64,
    pub staked_balance: u64,
    pub last_reward_claim: i64,
    pub total_shares: u128,
}

impl Agent {
    // Validate if movement is allowed
    pub fn validate_movement(
        &self,
        new_x: i32,
        new_y: i32,
        map_diameter: u32,
        timestamp: i64,
    ) -> Result<()> {
        // 1) Must be alive
        require!(self.is_alive, GameError::AgentNotAlive);

        // 2) Movement cooldown check
        require!(
            timestamp >= self.last_move + MOVEMENT_COOLDOWN,
            GameError::MovementCooldown
        );

        // 3) Check map boundaries
        let radius = (map_diameter / 2) as i32;
        let distance_from_center = ((new_x.pow(2) + new_y.pow(2)) as f64).sqrt();
        require!(distance_from_center <= radius as f64, GameError::OutOfBounds);

        Ok(())
    }

    // Validate that the agent can do an action (e.g. start a battle)
    pub fn validate_state(&self, timestamp: i64) -> Result<()> {
        require!(self.is_alive, GameError::AgentNotAlive);

        // Ensure no battle is in progress
        require!(
            self.current_battle_start.is_none(),
            GameError::BattleInProgress
        );

        // Check battle cooldown
        require!(
            timestamp >= self.last_battle + BATTLE_COOLDOWN,
            GameError::BattleCooldown
        );

        Ok(())
    }
}
