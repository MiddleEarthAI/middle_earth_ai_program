use anchor_lang::prelude::*;
pub use instructions::token::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod state;
pub mod instructions;
pub mod utils;

declare_id!("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");

// Import the instructions modules so we can reference their functions.
use instructions::*;
use crate::state::TerrainType; // Correctly import TerrainType from state

#[program]
pub mod middle_earth_ai_program {
    use super::*;

    pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u32, bump: u8) -> Result<()> {
        game::initialize_game(ctx, game_id, bump)
    }

    pub fn initialize_agent(ctx: Context<InitializeAgent>, agent_id: u8, x: i32, y: i32) -> Result<()> {
        agent::initialize_agent(ctx, agent_id, x, y)
    }

    // Update the move_agent function to accept a terrain parameter.
    pub fn move_agent(
        ctx: Context<MoveAgent>,
        new_x: i32,
        new_y: i32,
        terrain: TerrainType,
    ) -> Result<()> {
        movement::move_agent(ctx, new_x, new_y, terrain)
    }

    pub fn resolve_battle(ctx: Context<ResolveBattle>, transfer_amount: u64) -> Result<()> {
        battle::resolve_battle(ctx, transfer_amount)
    }
    
    pub fn form_alliance(ctx: Context<FormAlliance>, target_agent_id: u8) -> Result<()> {
        alliance::form_alliance(ctx, target_agent_id)
    }

    pub fn break_alliance(ctx: Context<BreakAlliance>) -> Result<()> {
        alliance::break_alliance(ctx)
    }

    pub fn ignore_agent(ctx: Context<IgnoreAgent>, target_agent_id: u8) -> Result<()> {
        ignore::ignore_agent(ctx, target_agent_id)
    }

    pub fn stake_tokens(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        token::stake_tokens(ctx, amount)
    }

    pub fn unstake_tokens(ctx: Context<UnstakeTokens>, amount: u64) -> Result<()> {
        token::unstake_tokens(ctx, amount)
    }

    pub fn claim_staking_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        token::claim_staking_rewards(ctx)
    }
}

#[derive(Accounts)]
pub struct Placeholder {}
