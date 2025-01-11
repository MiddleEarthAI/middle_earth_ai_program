// Example game configuration constants
pub const MAP_DIAMETER: u32 = 1000;
pub const BATTLE_RANGE: u32 = 50;
pub const MAX_AGENTS: u8 = 4;

pub const MOVEMENT_COOLDOWN: i64 = 3600;  // 1 hour
pub const BATTLE_COOLDOWN: i64 = 14400;   // 4 hours
pub const ALLIANCE_COOLDOWN: i64 = 86400; // 24 hours

pub const DEATH_CHANCE_TERRAIN: u64 = 10; // 10%
pub const DEATH_CHANCE_BATTLE: u64 = 20;  // 20%
pub const MIN_TOKEN_BURN: u64 = 31;       // 31%
pub const MAX_TOKEN_BURN: u64 = 50;       // 50%

pub const IGNORE_COOLDOWN: i64 = 14400;   // 4 hours
pub const BATTLE_DURATION_PER_TOKEN: u64 = 1; // 1 second per token

pub const MAX_STAKE_AMOUNT: u64 = 1_000_000; 
pub const TOKEN_DECIMALS: u8 = 9;
pub const MAX_ALLIANCE_DURATION: i64 = 7 * 24 * 60 * 60; // 1 week
pub const MIN_BATTLE_TOKENS: u64 = 1_000;
pub const MAX_BATTLE_DURATION: i64 = 24 * 60 * 60; // 24 hours

// Movement and Terrain
pub const MOVEMENT_SPEED: i64 = 10;
pub const MOUNTAIN_SPEED_REDUCTION: u32 = 50; 
pub const RIVER_SPEED_REDUCTION: u32 = 30;

// Rewards
pub const BASE_REWARD_RATE: f64 = 0.1; 
pub const MIN_REWARD_RATE: f64 = 0.05;
pub const MAX_REWARD_RATE: f64 = 0.2;
pub const REWARD_CLAIM_COOLDOWN: i64 = 86400; // 24 hours

pub const DAILY_REWARD_RATE: f64 = 0.1; 
