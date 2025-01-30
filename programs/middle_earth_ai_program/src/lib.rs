use anchor_lang::prelude::*;
pub use instructions::token::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod state;
pub mod instructions;
pub mod utils;

// Re-export TerrainType so it appears in the IDL.
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
        token::initialize_stake(ctx, deposit_amount)
    }

    pub fn end_game(ctx: Context<EndGame>) -> Result<()> {
        game::end_game(ctx)
    }

    /// Registers a new Agent in the game (init + list registration).
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        agent_id: u8,
        x: i32,
        y: i32,
        name: String,
    ) -> Result<()> {
        agent::register_agent(ctx, agent_id, x, y, name)
    }

    pub fn kill_agent(ctx: Context<KillAgent>) -> Result<()> {
        agent::kill_agent(ctx)
    }

    pub fn move_agent(
        ctx: Context<MoveAgent>,
        new_x: i32,
        new_y: i32,
        terrain: TerrainType,
    ) -> Result<()> {
        movement::move_agent(ctx, new_x, new_y, terrain)
    }

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

    pub fn resolve_battle_simple(
        ctx: Context<ResolveBattleSimple>,
        percent_loss: u8
    ) -> Result<()> {
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

    pub fn update_daily_rewards(ctx: Context<UpdateDailyRewards>, new_daily_reward: u64) -> Result<()> {
        token::update_daily_rewards(ctx, new_daily_reward)
    }

    /// Allows a staker to initiate a 2-hour cooldown before unstaking.
    pub fn initiate_cooldown(ctx: Context<InitiateCooldown>) -> Result<()> {
        token::initiate_cooldown(ctx)
    }
       /// Starts a battle between an agent and an alliance.
       pub fn start_battle_agent_vs_alliance(ctx: Context<StartBattleAgentVsAlliance>) -> Result<()> {
        battle::start_battle_agent_vs_alliance(ctx)
    }

    /// Starts a battle between two alliances.
    pub fn start_battle_alliances(ctx: Context<StartBattleAlliances>) -> Result<()> {
        battle::start_battle_alliance_vs_alliance(ctx)
    }

    pub fn start_battle_simple(ctx: Context<StartBattleSimple>) -> Result<()> {
        battle::start_battle_simple(ctx)
    }

    pub fn set_agent_cooldown(ctx: Context<SetAgentCooldown>, new_cooldown: i64) -> Result<()> {
        agent::set_agent_cooldown(ctx, new_cooldown)
    }



 

}

#[derive(Accounts)]
pub struct Placeholder {}
