use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;

pub fn register_agent(
    ctx: Context<RegisterAgent>,
    agent_id: u8,
    x: i32,
    y: i32,
    name: String,
) -> Result<()> {
    let game_account = &mut ctx.accounts.game;
    // Only allow if the signer is the game authority.
    require!(
        ctx.accounts.authority.key() == game_account.authority,
        GameError::Unauthorized
    );

    let agent_account = &mut ctx.accounts.agent;

    // Ensure the game is active.
    require!(game_account.is_active, GameError::GameNotActive);

    // Ensure the agent is not already registered.
    let agent_key = agent_account.key();
    require!(
        !game_account.agents.iter().any(|a| a.key == agent_key),
        GameError::AgentAlreadyExists
    );

    // Initialize the agent.
    agent_account.game = game_account.key();
    // Even though the agent may eventually be controlled by a user,
    // for registration purposes we record the game authority as the creator.
    agent_account.authority = ctx.accounts.authority.key();
    agent_account.id = agent_id;
    agent_account.x = x;
    agent_account.y = y;
    agent_account.is_alive = true;
    agent_account.last_move = 0;
    agent_account.last_battle = 0;
    agent_account.alliance_with = None;
    agent_account.alliance_timestamp = 0;
    agent_account.token_balance = 0;
    agent_account.last_reward_claim = 0;
    agent_account.total_shares = 0;
    agent_account.last_attack = 0;
    agent_account.last_ignore = 0;
    agent_account.last_alliance = 0;
    agent_account.next_move_time = 0;
    agent_account.vault_bump = 0;
    agent_account.last_alliance_agent = None;
    agent_account.last_alliance_broken = 0;
    agent_account.battle_start_time = None;

    // Register the agent in the global list with the provided name.
    game_account.agents.push(crate::state::agent_info::AgentInfo {
        key: agent_key,
        name,
    });

    Ok(())
}

/// Marks an agent as dead by setting its `is_alive` field to false.
///
/// **Access Control:** Only the game authority may call this instruction.
pub fn kill_agent(ctx: Context<KillAgent>) -> Result<()> {
    // Only allow if the signer is the game authority.
    require!(
        ctx.accounts.authority.key() == ctx.accounts.game.authority,
        GameError::Unauthorized
    );
    let agent_account = &mut ctx.accounts.agent;
    agent_account.is_alive = false;
    Ok(())
}

/// Sets an agent's cooldown, e.g. for testing or manual override.
/// **Access Control:** Only the game authority may call this instruction.
pub fn set_agent_cooldown(
    ctx: Context<SetAgentCooldown>,
    new_next_move_time: i64,
) -> Result<()> {
    // Only allow if the signer is the game authority.
    require!(
        ctx.accounts.authority.key() == ctx.accounts.game.authority,
        GameError::Unauthorized
    );
    let agent = &mut ctx.accounts.agent;
    agent.set_attack_cooldown(new_next_move_time);
    Ok(())
}

// -------------------------
// ACCOUNTS
// -------------------------

#[derive(Accounts)]
#[instruction(agent_id: u8, x: i32, y: i32, name: String)]
pub struct RegisterAgent<'info> {
    #[account(
        mut,
        constraint = game.is_active @ GameError::ReentrancyGuard
    )]
    pub game: Account<'info, Game>,

    /// The Agent account is initialized using PDA seeds.
    #[account(
        init,
        payer = authority,
        seeds = [b"agent", game.key().as_ref(), &[agent_id]],
        bump,
        space = 8 + Agent::INIT_SPACE
    )]
    pub agent: Account<'info, Agent>,

    /// The caller must be the game authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct KillAgent<'info> {
    #[account(mut, has_one = authority)]
    pub agent: Account<'info, Agent>,

    // We add the game account so that we can check that the caller is the game authority.
    pub game: Account<'info, Game>,

    /// The caller must be the game authority.
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetAgentCooldown<'info> {
    #[account(mut, has_one = game)]
    pub agent: Account<'info, Agent>,

    pub game: Account<'info, Game>,

    /// The caller must be the game authority.
    #[account(mut)]
    pub authority: Signer<'info>,
}
