use anchor_lang::prelude::*;
use crate::state::{Agent, Game};
use crate::error::GameError;
use crate::constants::*;

/// Creates (initializes) a new Agent account on-chain.
pub fn initialize_agent(
    ctx: Context<InitializeAgent>,
    agent_id: u8,
    x: i32,
    y: i32
) -> Result<()> {
    let agent_account = &mut ctx.accounts.agent;
    let game_account = &ctx.accounts.game;

    // Ensure the Game is active
    require!(game_account.is_active, GameError::ReentrancyGuard);

    // Populate the Agent's fields
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

/// Defines the `InitializeAgent` instruction context.
#[derive(Accounts)]
#[instruction(agent_id: u8, x: i32, y: i32)]
pub struct InitializeAgent<'info> {
    /// Reference to the Game account (must already exist).
    /// We also ensure the game has the same authority that is signing.
    #[account(
        mut,
        has_one = authority,
        constraint = game.is_active @ GameError::ReentrancyGuard
    )]
    pub game: Account<'info, Game>,

    /// The new Agent account, created with a PDA seed.
    #[account(
        init,
        payer = authority,
        seeds = [
            b"agent",
            &game.key().to_bytes(),
            &[agent_id]
        ],
        bump,
        space = 8 + Agent::INIT_SPACE
    )]
    pub agent: Account<'info, Agent>,

    /// The user signing to create this Agent.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Needed to initialize new accounts.
    pub system_program: Program<'info, System>,
}
