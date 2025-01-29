use anchor_lang::prelude::*;
use crate::constants::*;
use crate::error::GameError;
use crate::state::TerrainType;

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
    pub alliance_with: Option<Pubkey>,     // ID of agent allied with
    pub alliance_timestamp: i64,       // When alliance was formed

    // Token/staking info
    pub token_balance: u64,            // Deprecated if querying real-time vault balance
    pub staked_balance: u64,           // Total tokens staked
    pub last_reward_claim: i64,        // Last reward claim timestamp
    pub total_shares: u128,            // Total shares representing staking pool ownership
    pub last_attack: i64,
    pub last_ignore: i64,
    pub last_alliance: i64,
    pub next_move_time: i64,
    pub last_alliance_agent: Option<Pubkey>, // Pubkey of the last allied agent
    pub last_alliance_broken: i64,  
    pub battle_start_time: Option<i64>, // Store battle start time (None if not in battle)

    // PDA-related info
    pub vault_bump: u8,                // Bump seed for the PDA representing the agent's vault
}

// Helper methods on the Agent data structure
impl Agent {
    pub fn validate_movement(&self, now: i64) -> Result<()> {
        require!(self.is_alive, GameError::AgentNotAlive);
        require!(now >= self.next_move_time, GameError::MovementCooldown);
        Ok(())
    }

    pub fn apply_terrain_move_cooldown(&mut self, terrain: TerrainType, now: i64) -> Result<()> {
        let added_cooldown = match terrain {
            TerrainType::Plain => 3600,       // 1 hour in seconds
            TerrainType::River => 7200,       // 2 hours
            TerrainType::Mountain => 10800,   // 3 hours
            // Add more terrain types as needed
        };
        self.next_move_time = now + added_cooldown;
        Ok(())
    }

    pub fn validate_attack(&self, now: i64) -> Result<()> {
        require!(now >= self.last_attack + ACTION_COOLDOWN_SECS, GameError::BattleCooldown);
        Ok(())
    }

    pub fn validate_ignore(&self, now: i64) -> Result<()> {
        require!(now >= self.last_ignore + ACTION_COOLDOWN_SECS, GameError::IgnoreCooldown);
        Ok(())
    }

    pub fn validate_alliance(&self, now: i64) -> Result<()> {
        require!(now >= self.last_alliance + ACTION_COOLDOWN_SECS, GameError::AllianceCooldown);
        Ok(())
    }
}
