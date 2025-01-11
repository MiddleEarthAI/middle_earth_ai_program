use anchor_lang::prelude::*;

#[error_code]
pub enum GameError {
    #[msg("Agent is not alive.")]
    AgentNotAlive,
    #[msg("Movement is on cooldown.")]
    MovementCooldown,
    #[msg("Agent is out of map bounds.")]
    OutOfBounds,
    #[msg("Battle is currently in progress.")]
    BattleInProgress,
    #[msg("Battle is on cooldown.")]
    BattleCooldown,
    #[msg("Reentrancy attempt detected.")]
    ReentrancyGuard,
    #[msg("Alliance in cooldown.")]
    AllianceCooldown,
    #[msg("Not enough tokens for battle.")]
    NotEnoughTokens,
    #[msg("Stake amount exceeds maximum allowed.")]
    MaxStakeExceeded,
    #[msg("Cannot claim rewards yet.")]
    ClaimCooldown,
    #[msg("Invalid terrain movement.")]
    InvalidTerrain,
    // Add more as needed
}
