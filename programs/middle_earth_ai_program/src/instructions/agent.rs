use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;

/// Combines the functionalities of `initialize_agent` and `add_agent`. 
/// This function initializes an agent account and registers it in the global agent list.
/// 
pub fn register_agent(
    ctx: Context<RegisterAgent>,
    agent_id: u8,
    x: i32,
    y: i32,
    name: String,
) -> Result<()> {
    let game_account = &mut ctx.accounts.game;
    let agent_account = &mut ctx.accounts.agent;

    // Cache the agent's public key before modifying it.
    let agent_key = agent_account.key();

    // Ensure the game is active.
    require!(game_account.is_active, GameError::ReentrancyGuard);

    // Ensure the name is within the allowed length.
    require!(name.len() <= 32, GameError::NameTooLong);

    // Ensure the global agent list does not exceed the limit.

    // Ensure the agent is not already registered in the game's global list.
    require!(
        !game_account.agents.iter().any(|a| a.key == agent_key),
        GameError::AgentAlreadyExists
    );

    // Initialize the agent account.
    agent_account.game = game_account.key();
    agent_account.authority = ctx.accounts.authority.key();
    agent_account.id = agent_id;
    agent_account.x = x;
    agent_account.y = y;
    agent_account.is_alive = true;
    agent_account.last_move = 0;
    agent_account.last_battle = 0;
    agent_account.current_battle_start = None;
    agent_account.alliance_with = None;
    agent_account.alliance_timestamp = 0;
    agent_account.token_balance = 0;
    agent_account.staked_balance = 0;
    agent_account.last_reward_claim = 0;
    agent_account.total_shares = 0;
    agent_account.last_attack = 0;
    agent_account.last_ignore = 0;
    agent_account.last_alliance = 0;
    agent_account.next_move_time = 0;
    agent_account.vault_bump = 0;

    // Initialize the new fields for alliance tracking.
    agent_account.last_alliance_agent = None; // No last alliance agent at registration
    agent_account.last_alliance_broken = 0;     // No alliance break timestamp at registration

    // Register the agent in the global list with the provided name.
    game_account.agents.push(crate::state::agent_info::AgentInfo {
        key: agent_key,
        name,
    });

    Ok(())
}

/// Marks an agent as dead by setting its `is_alive` field to false.
/// 
pub fn kill_agent(ctx: Context<KillAgent>) -> Result<()> {
    let agent_account = &mut ctx.accounts.agent;


    require!(ctx.accounts.authority.key() == agent_account.authority, GameError::Unauthorized);

    // Mark the agent as dead.
    agent_account.is_alive = false;

    Ok(())
}

#[derive(Accounts)]
#[instruction(agent_id: u8, x: i32, y: i32, name: String)]
pub struct RegisterAgent<'info> {
    // The Game account must be mutable and have an authority.
    // Access control: It also checks that the game is active.
    #[account(
        mut,
        constraint = game.is_active @ GameError::ReentrancyGuard
    )]
    pub game: Account<'info, Game>,

    /// The Agent account is initialized using PDA seeds.
    #[account(
        init,
        payer = authority,
        seeds = [
            b"agent",
            game.key().as_ref(),
            &[agent_id],
        ],
        bump,
        space = 8 + Agent::INIT_SPACE
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Accounts context for killing an agent.
#[derive(Accounts)]
pub struct KillAgent<'info> {
    #[account(mut, has_one = authority)]
    pub agent: Account<'info, Agent>,
    /// The authority that can perform the kill. In many cases this should match agent.authority.
    pub authority: Signer<'info>,
}
