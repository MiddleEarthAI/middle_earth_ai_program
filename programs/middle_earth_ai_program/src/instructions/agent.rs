use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;

/// Registers a new agent under the specified game.
///
/// This creates and initializes the agent account using PDA seeds
/// and also registers it in the global agent list on the `Game` account.
pub fn register_agent(
    ctx: Context<RegisterAgent>,
    agent_id: u8,
    x: i32,
    y: i32,
    name: String,
) -> Result<()> {
    let game_account = &mut ctx.accounts.game;
    let agent_account = &mut ctx.accounts.agent;

    // Ensure the game is active.
    require!(game_account.is_active, GameError::ReentrancyGuard);

    // Name length check (adjust if needed).
    require!(name.len() <= 32, GameError::NameTooLong);

    // Ensure the agent is not already registered.
    let agent_key = agent_account.key();
    require!(
        !game_account.agents.iter().any(|a| a.key == agent_key),
        GameError::AgentAlreadyExists
    );

    // Initialize the agent.
    agent_account.game = game_account.key();
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
    agent_account.staked_balance = 0;
    agent_account.last_reward_claim = 0;
    agent_account.total_shares = 0;
    agent_account.last_attack = 0;
    agent_account.last_ignore = 0;
    agent_account.last_alliance = 0;
    agent_account.next_move_time = 0;
    agent_account.vault_bump = 0;
    // If you track alliance events:
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
pub fn kill_agent(ctx: Context<KillAgent>) -> Result<()> {
    let agent_account = &mut ctx.accounts.agent;

    // Typically, the agent's own authority can kill it, 
    // or the game authority, depending on your logic.
    require!(ctx.accounts.authority.key() == agent_account.authority, GameError::Unauthorized);

    agent_account.is_alive = false;
    Ok(())
}

/// Sets an agent's cooldown, e.g. for testing or manual override.
/// This function is demonstration/test-only and not recommended for production.
// pub fn set_agent_cooldown(
//     ctx: Context<SetAgentCooldown>,
//     new_next_move_time: i64,
// ) -> Result<()> {
//     let agent = &mut ctx.accounts.agent;
//     agent.set_attack_cooldown(new_next_move_time);
//     Ok(())
// }

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

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct KillAgent<'info> {
    #[account(mut, has_one = authority)]
    pub agent: Account<'info, Agent>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

// #[derive(Accounts)]
// pub struct SetAgentCooldown<'info> {
//     #[account(mut, has_one = game)]
//     pub agent: Account<'info, Agent>,
//     pub game: Account<'info, Game>,

//     #[account(mut)]
//     pub authority: Signer<'info>,
// }
