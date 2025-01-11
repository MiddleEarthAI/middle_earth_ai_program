use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod state;
pub mod instructions;
pub mod utils;

declare_id!("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");

// Import the instructions modules so we can reference their functions.
use instructions::*;

#[program]
pub mod middle_earth_ai_program {
    use super::*;

    /// Expose the initialize_game instruction.
    /// Note: This function now requires a `bump: u8` parameter.
    pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u32, bump: u8) -> Result<()> {
        // This calls the implementation in instructions/game.rs.
        game::initialize_game(ctx, game_id, bump)
    }

    /// Expose the initialize_agent instruction.
    pub fn initialize_agent(ctx: Context<InitializeAgent>, agent_id: u8, x: i32, y: i32) -> Result<()> {
        // This calls the implementation in instructions/agent.rs.
        agent::initialize_agent(ctx, agent_id, x, y)
    }

    // You can add additional instructions here.
}

#[derive(Accounts)]
pub struct Placeholder {}
