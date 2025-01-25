use anchor_lang::prelude::*;
pub use instructions::token::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod state;
pub mod instructions;
pub mod utils;

// Re-export TerrainType from the state module so it appears in the IDL.
pub use state::terrain::TerrainType;

declare_id!("FE7WJhRY55XjHcR22ryA3tHLq6fkDNgZBpbh25tto67Q");

// Import the instructions modules so we can reference their functions.
use instructions::*;

#[program]
pub mod middle_earth_ai_program {
    use super::*;

    pub fn initialize_game(ctx: Context<InitializeGame>, game_id: u32, bump: u8) -> Result<()> {
        game::initialize_game(ctx, game_id, bump)
    }
    pub fn initialize_stake(ctx: Context<InitializeStake>, deposit_amount: u64) -> Result<()> {
        instructions::token::initialize_stake(ctx, deposit_amount)
    }
    pub fn end_game(ctx: Context<EndGame>) -> Result<()> {
        game::end_game(ctx)
    }

    /// Combined function for agent registration.
    /// This instruction both initializes an Agent account and registers it in the game’s agent list.
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        agent_id: u8, // single byte identifier
        x: i32,
        y: i32,
        name: String,
    ) -> Result<()> {
        agent::register_agent(ctx, agent_id, x, y, name)
    }
    
    /// Marks an agent as dead.
    /// **Access Control:** Only the agent's authority (or game authority) may call this function.
    pub fn kill_agent(ctx: Context<KillAgent>) -> Result<()> {
        agent::kill_agent(ctx)
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

    /// Resolves a battle with alliances by updating cooldowns for all allied agents.

    pub fn resolve_battle_agent_vs_alliance(
        ctx: Context<ResolveBattleAgentAlliance>,
        percent_lost: u8,
        agent_is_winner: bool,
    ) -> Result<()> {
        battle::resolve_battle_agent_vs_alliance(ctx, percent_lost, agent_is_winner)
    }
    
    pub fn resolve_battle_alliance_vs_alliance(
        ctx: Context<ResolveBattleAlliances>,
        percent_lost: u8,
        alliance_a_wins: bool,
    ) -> Result<()> {
        battle::resolve_battle_alliance_vs_alliance(ctx, percent_lost, alliance_a_wins)
    }
    /// Resolves a simple battle (without alliances) by updating the winner's and loser's cooldowns.
    pub fn resolve_battle_simple(ctx: Context<ResolveBattleSimple>, percent_loss: u8) -> Result<()> {
        battle::resolve_battle_simple(ctx, percent_loss)
    }
    
    pub fn form_alliance(ctx: Context<FormAlliance>) -> Result<()> {
        alliance::form_alliance(ctx)
    }

    pub fn break_alliance(ctx: Context<BreakAlliance>) -> Result<()> {
        alliance::break_alliance(ctx)
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
