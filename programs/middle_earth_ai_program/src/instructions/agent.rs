use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;

/// Create an individual Agent account. This function should be called only once per agent.
/// The account is created using PDA seeds: [b"agent", game.key().as_ref(), &[agent_id]].
pub fn initialize_agent(
    ctx: Context<InitializeAgent>,
    agent_id: u8, // single byte
    x: i32,
    y: i32
) -> Result<()> {
    let agent_account = &mut ctx.accounts.agent;
    let game_account = &ctx.accounts.game;

    // Ensure the game is active.
    require!(game_account.is_active, GameError::ReentrancyGuard);

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
    agent_account.ignore_cooldowns = Vec::new();
    agent_account.token_balance = 0;
    agent_account.staked_balance = 0;
    agent_account.last_reward_claim = 0;
    agent_account.total_shares = 0;
    agent_account.last_attack = 0;
    agent_account.last_ignore = 0;
    agent_account.last_alliance = 0;
    agent_account.next_move_time = 0;
    agent_account.vault_bump = 0;

    Ok(())
}

#[derive(Accounts)]
#[instruction(agent_id: u8, x: i32, y: i32)]
pub struct InitializeAgent<'info> {
    #[account(
        mut,
        has_one = authority,
        constraint = game.is_active @ GameError::ReentrancyGuard
    )]
    pub game: Account<'info, Game>,

    /// Create the Agent account using PDA seeds.
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

/// Add an agent’s information (public key and name) to the Game’s global agent list.
/// This instruction does not create a new Agent account—it merely records the agent’s info
/// in the Game account. Only the game authority is allowed to call this.
pub fn add_agent(ctx: Context<AddAgent>, agent_key: Pubkey, name: String) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Only the game authority may add agents.
    require!(ctx.accounts.authority.key() == game.authority, GameError::Unauthorized);

    // Check that the number of agents is less than 4.
    if game.agents.len() >= 4 {
        return Err(GameError::MaxAgentLimitReached.into());
    }

    // Check that the agent is not already present.
    if game.agents.iter().any(|a| a.key == agent_key) {
        return Err(GameError::AgentAlreadyExists.into());
    }

    // Check name length (for example, maximum 32 characters).
    if name.len() > 32 {
        return Err(GameError::NameTooLong.into());
    }

    // Add the new AgentInfo to the global list.
    game.agents.push(crate::state::agent_info::AgentInfo { key: agent_key, name });

    Ok(())
}

#[derive(Accounts)]
pub struct AddAgent<'info> {
    #[account(mut, has_one = authority)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
