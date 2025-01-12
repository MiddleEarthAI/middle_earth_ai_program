use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
/// Example: create an Agent. 
/// 
/// If `agent_id` is a single byte, seeds = [b"agent", game.key().as_ref(), &[agent_id]] 
/// is a 5 + 32 + 1 = 38-byte seed array. That’s fine.
pub fn initialize_agent(
    ctx: Context<InitializeAgent>,
    agent_id: u8,  // single byte
    x: i32,
    y: i32
) -> Result<()> {
    let agent_account = &mut ctx.accounts.agent;
    let game_account = &ctx.accounts.game;

    // If the game is not active, error
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

    /// We create the Agent account with seeds:
    ///   [ b"agent", game.key().as_ref(), &[agent_id] ]
    /// if agent_id is a single byte
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
