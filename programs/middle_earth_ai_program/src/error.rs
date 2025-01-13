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
    #[msg("Alliance is on cooldown.")]
    AllianceCooldown,
    #[msg("Not enough tokens for battle.")]
    NotEnoughTokens,    
    #[msg("Stake amount exceeds maximum allowed.")]
    MaxStakeExceeded,
    #[msg("Cannot claim rewards yet.")]
    ClaimCooldown,
    #[msg("Invalid terrain movement.")]
    InvalidTerrain,
    #[msg("Invalid token transfer.")]
    TokenTransferError,
    #[msg("Insufficient Funds Provided.")]
    InsufficientFunds,
    #[msg("Unauthorized action.")]
    Unauthorized,
    #[msg("Cooldown is still active.")]
    IgnoreCooldown,
    #[msg("Invalid alliance partner.")]
    InvalidAlliancePartner,
    #[msg("An active alliance already exists.")]
    AllianceAlreadyExists,
    #[msg("No active alliance to break.")]
    NoAllianceToBreak,
    #[msg("Maximum number of agents reached.")]
    MaxAgentLimitReached,
    #[msg("Agent already exists.")]
    AgentAlreadyExists,
    #[msg("Agent name is too long.")]
    NameTooLong,
}
